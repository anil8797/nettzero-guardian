import {
    MessageError,
    MessageResponse,
    ModelHelper,
    PolicyEngineEvents,
    SchemaEntity,
    SchemaHelper,
    SchemaStatus,
    TopicType
} from 'interfaces';
import {
    findAllEntities,
    replaceAllEntities,
    SchemaFields
} from '@helpers/utils';
import {
    HederaSDKHelper,
    MessageAction,
    MessageServer,
    MessageType,
    PolicyMessage
} from '@hedera-modules'
import {
    IPolicyBlock,
    IPolicyInterfaceBlock
} from './policy-engine.interface';
import { Schema as SchemaCollection } from '@entity/schema';
import { VcDocument as VcDocumentCollection } from '@entity/vc-document';
import { incrementSchemaVersion, publishSchema } from '@api/schema.service';
import { PolicyImportExportHelper } from './helpers/policy-import-export-helper';
import { VcHelper } from '@helpers/vcHelper';
import { Users } from '@helpers/users';
import { Inject } from '@helpers/decorators/inject';
import { Logger } from 'logger-helper';
import { Policy } from '@entity/policy';
import { getConnection, getMongoRepository } from 'typeorm';
import { DeepPartial } from 'typeorm/common/DeepPartial';
import { IAuthUser } from '@auth/auth.interface';
import { PolicyComponentsUtils } from './policy-components-utils';
import { BlockTreeGenerator } from './block-tree-generator';
import { Topic } from '@entity/topic';
import { TopicHelper } from '@helpers/topicHelper';

export class PolicyEngineService {
    @Inject()
    private users: Users;

    private channel: any;
    private policyGenerator: BlockTreeGenerator;

    constructor(channel: any) {
        this.channel = channel;
        this.policyGenerator = new BlockTreeGenerator();

        PolicyComponentsUtils.BlockUpdateFn = (...args: any[]) => {
            this.stateChangeCb.apply(this, args);
        };

        PolicyComponentsUtils.BlockErrorFn = (...args: any[]) => {
            this.blockErrorCb.apply(this, args);
        };
    }

    /**
     * Callback fires when block state changed
     * @param uuid {string} - id of block
     * @param user {IAuthUser} - short user object
     */
    private async stateChangeCb(uuid: string, state: any, user: IAuthUser) {
        if (!user || !user.did) {
            return;
        }

        const block = PolicyComponentsUtils.GetBlockByUUID(uuid) as IPolicyInterfaceBlock;
        const policy = await getMongoRepository(Policy).findOne(block.policyId)
        const role = policy.registeredUsers[user.did];

        if (PolicyComponentsUtils.IfUUIDRegistered(uuid) && PolicyComponentsUtils.IfHasPermission(uuid, role, user)) {
            await this.channel.request('api-gateway', 'update-block', {
                uuid,
                state,
                user
            })
        }
    }

    private async blockErrorCb(blockType: string, message: any, user: IAuthUser) {
        if (!user || !user.did) {
            return;
        }

        await this.channel.request('api-gateway', 'block-error', {
            blockType,
            message,
            user
        });
    }

    private async createPolicy(data: Policy, owner: string): Promise<Policy> {
        const model = getMongoRepository(Policy).create(data as DeepPartial<Policy>);
        if (!model.config) {
            model.config = {
                'blockType': 'interfaceContainerBlock',
                'permissions': [
                    'ANY_ROLE'
                ]
            }
        }

        if (model.uuid) {
            const old = await getMongoRepository(Policy).findOne({ uuid: model.uuid });
            if (model.creator != owner) {
                throw 'Invalid owner';
            }
            if (old.creator != owner) {
                throw 'Invalid owner';
            }
            model.creator = owner;
            model.owner = owner;
            delete model.version;
            delete model.messageId;
        } else {
            model.creator = owner;
            model.owner = owner;
            delete model.previousVersion;
            delete model.topicId;
            delete model.version;
            delete model.messageId;
        }

        let newTopic: Topic;
        const root = await this.users.getHederaAccount(owner);
        if (model.topicId) {
            const topic = await getMongoRepository(Topic).findOne({ topicId: model.topicId });
        } else {
            const parent = await getMongoRepository(Topic).findOne({ owner: owner, type: TopicType.UserTopic });
            const topicHelper = new TopicHelper(root.hederaAccountId, root.hederaAccountKey);
            const topic = await topicHelper.create({
                type: TopicType.PolicyTopic,
                name: model.name || TopicType.PolicyTopic,
                description: model.topicDescription || TopicType.PolicyTopic,
                owner: owner,
                policyId: null,
                policyUUID: null
            });
            model.topicId = topic.topicId;

            const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey);
            const message = new PolicyMessage(MessageType.Policy, MessageAction.CreatePolicy);
            message.setDocument(model);
            const messageStatus = await messageServer
                .setTopicObject(topic)
                .sendMessage(message);

            await topicHelper.link(topic, parent, messageStatus.getId());
            newTopic = topic;
        }

        const policy = await getMongoRepository(Policy).save(model);
        if (newTopic) {
            newTopic.policyId = policy.id.toString();
            newTopic.policyUUID = policy.uuid;
            await getMongoRepository(Topic).update(newTopic.id, newTopic);
        }

        return policy;
    }

    private async updatePolicy(policyId: any, data: Policy): Promise<Policy> {
        const model = await getMongoRepository(Policy).findOne(policyId);
        model.config = data.config;
        model.name = data.name;
        model.version = data.version;
        model.description = data.description;
        model.topicDescription = data.topicDescription;
        model.policyRoles = data.policyRoles;
        model.policyTopics = data.policyTopics;
        delete model.registeredUsers;
        return await getMongoRepository(Policy).save(model);
    }

    private async publishSchemes(model: Policy, owner: string): Promise<Policy> {
        const schemaIRIs = findAllEntities(model.config, SchemaFields);
        for (let i = 0; i < schemaIRIs.length; i++) {
            const schemaIRI = schemaIRIs[i];
            const schema = await incrementSchemaVersion(schemaIRI, owner);
            if (schema.status == SchemaStatus.PUBLISHED) {
                continue;
            }
            const newSchema = await publishSchema(schema.id, schema.version, owner);
            replaceAllEntities(model.config, SchemaFields, schemaIRI, newSchema.iri);
        }
        return model;
    }

    private async publishPolicy(model: Policy, owner: string, version: string): Promise<Policy> {
        model = await this.publishSchemes(model, owner);
        model.status = 'PUBLISH';
        model.version = version;

        this.policyGenerator.regenerateIds(model.config);
        const zip = await PolicyImportExportHelper.generateZipFile(model);
        const buffer = await zip.generateAsync({ type: 'arraybuffer' });

        const root = await this.users.getHederaAccount(owner);
        const topic = await getMongoRepository(Topic).findOne({ topicId: model.topicId });
        const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey);

        const topicHelper = new TopicHelper(root.hederaAccountId, root.hederaAccountKey);
        const rootTopic = await topicHelper.create({
            type: TopicType.InstancePolicyTopic,
            name: model.name || TopicType.InstancePolicyTopic,
            description: model.topicDescription || TopicType.InstancePolicyTopic,
            owner: owner,
            policyId: model.id.toString(),
            policyUUID: model.uuid
        });

        const message = new PolicyMessage(MessageType.InstancePolicy, MessageAction.PublishPolicy);
        message.setDocument(model, buffer);
        const result = await messageServer.setTopicObject(topic).sendMessage(message);
        model.messageId = result.getId();
        model.instanceTopicId = rootTopic.topicId;

        await topicHelper.link(rootTopic, topic, result.getId());

        const messageId = result.getId();
        const url = result.getUrl();
        const policySchema = await getMongoRepository(SchemaCollection).findOne({ entity: SchemaEntity.POLICY });
        const vcHelper = new VcHelper();
        const credentialSubject = {
            ...SchemaHelper.getContext(policySchema),
            id: messageId,
            name: model.name,
            description: model.description,
            topicDescription: model.topicDescription,
            version: model.version,
            policyTag: model.policyTag,
            owner: model.owner,
            cid: url.cid,
            url: url.url,
            uuid: model.uuid,
            operation: 'PUBLISH'
        }
        const vc = await vcHelper.createVC(owner, root.hederaAccountKey, credentialSubject);
        const doc = getMongoRepository(VcDocumentCollection).create({
            hash: vc.toCredentialHash(),
            owner: owner,
            document: vc.toJsonTree(),
            type: SchemaEntity.POLICY,
            policyId: `${model.id}`
        });
        await getMongoRepository(VcDocumentCollection).save(doc);

        return await getMongoRepository(Policy).save(model);
    }

    /**
     * Register endpoints for policy engine
     * @private
     */
    public registerListeners(): void {
        this.channel.response('mrv-data', async (msg, res) => {
            await PolicyComponentsUtils.ReceiveExternalData(msg.payload);
            res.send();
        });

        this.channel.response(PolicyEngineEvents.GET_POLICY, async (msg, res) => {
            const { filters, userDid } = msg.payload;
            const data: any = await getMongoRepository(Policy).findOne(filters);
            if (data) {
                if (userDid) {
                    data.userRoles = [];
                    if (data.owner === userDid) {
                        data.userRoles.push('Administrator');
                    }
                    if (data.registeredUsers && data.registeredUsers[userDid]) {
                        data.userRoles.push(data.registeredUsers[userDid]);
                    }
                    if (!data.userRoles.length) {
                        data.userRoles.push('The user does not have a role');
                    }
                }
                delete data.registeredUsers;
            }
            res.send(new MessageResponse(data));
        });

        this.channel.response(PolicyEngineEvents.GET_POLICIES, async (msg, res) => {
            try {
                const { filters, pageIndex, pageSize, userDid } = msg.payload;
                const filter: any = { where: filters }
                const _pageSize = parseInt(pageSize, 10);
                const _pageIndex = parseInt(pageIndex, 10);
                if (Number.isInteger(_pageSize) && Number.isInteger(_pageIndex)) {
                    filter.order = { createDate: "DESC" };
                    filter.take = _pageSize;
                    filter.skip = _pageIndex * _pageSize;
                }
                const [policies, count] = await getMongoRepository(Policy).findAndCount(filter);
                if (userDid) {
                    policies.forEach((policy: any) => {
                        policy.userRoles = [];
                        if (policy.owner === userDid) {
                            policy.userRoles.push('Administrator');
                        }
                        if (policy.registeredUsers && policy.registeredUsers[userDid]) {
                            policy.userRoles.push(policy.registeredUsers[userDid]);
                        }
                        if (!policy.userRoles.length) {
                            policy.userRoles.push('The user does not have a role');
                        }
                    });
                }
                policies.forEach(policy => {
                    delete policy.registeredUsers;
                });

                res.send(new MessageResponse({ policies, count }));
            } catch (error) {
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.CREATE_POLICIES, async (msg, res) => {
            try {
                const user = msg.payload.user;
                const userFull = await this.users.getUser(user.username);
                await this.createPolicy(msg.payload.model, userFull.did);
                const policies = await getMongoRepository(Policy).find({ owner: userFull.did });
                policies.forEach(p => {
                    delete p.registeredUsers;
                });
                res.send(new MessageResponse(policies));
            } catch (error) {
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.SAVE_POLICIES, async (msg, res) => {
            try {
                const result = await this.updatePolicy(msg.payload.policyId, msg.payload.model);
                delete result.registeredUsers;
                res.send(new MessageResponse(result));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                console.error(error);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.PUBLISH_POLICIES, async (msg, res) => {
            try {
                if (!msg.payload.model || !msg.payload.model.policyVersion) {
                    throw new Error('Policy version in body is empty');
                }

                const policyId = msg.payload.policyId;
                const version = msg.payload.model.policyVersion;
                const user = msg.payload.user;
                const userFull = await this.users.getUser(user.username);
                const owner = userFull.did;

                const model = await getMongoRepository(Policy).findOne(policyId);
                if (!model) {
                    throw new Error('Unknown policy');
                }
                if (!model.config) {
                    throw new Error('The policy is empty');
                }
                if (!ModelHelper.checkVersionFormat(version)) {
                    throw new Error('Invalid version format');
                }
                if (ModelHelper.versionCompare(version, model.previousVersion) <= 0) {
                    throw new Error('Version must be greater than ' + model.previousVersion);
                }
                const countModels = await getMongoRepository(Policy).count({
                    version: version,
                    uuid: model.uuid
                });
                if (countModels > 0) {
                    throw new Error('Policy with current version already was published');
                }

                const errors = await this.policyGenerator.validate(policyId);
                const isValid = !errors.blocks.some(block => !block.isValid);

                if (isValid) {
                    const newPolicy = await this.publishPolicy(model, owner, version);
                    await this.policyGenerator.generate(newPolicy.id.toString());
                }

                const policies = (await getMongoRepository(Policy).find({ owner: owner })).map(item => {
                    delete item.registeredUsers;
                    return item;
                });

                res.send(new MessageResponse({
                    policies: policies,
                    isValid,
                    errors
                }));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                console.error(error.message);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.VALIDATE_POLICIES, async (msg, res) => {
            try {
                const policy = msg.payload.model as Policy;
                const results = await this.policyGenerator.validate(policy);
                delete policy.registeredUsers;
                res.send(new MessageResponse({
                    results,
                    policy
                }));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.POLICY_BLOCKS, async (msg, res) => {
            try {
                const block = this.policyGenerator.getRoot(msg.payload.policyId);
                const user = msg.payload.user;
                const userFull = await this.users.getUser(user.username);
                res.send(new MessageResponse(await block.getData(userFull, block.uuid)));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                console.error(error);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.GET_BLOCK_DATA, async (msg, res) => {
            try {
                const { user, blockId, policyId } = msg.payload;
                const userFull = await this.users.getUser(user.username);
                const data = await (PolicyComponentsUtils.GetBlockByUUID(blockId) as IPolicyInterfaceBlock).getData(userFull, blockId, null)
                res.send(new MessageResponse(data));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.SET_BLOCK_DATA, async (msg, res) => {
            try {
                const { user, blockId, policyId, data } = msg.payload;
                const userFull = await this.users.getUser(user.username);
                const result = await (PolicyComponentsUtils.GetBlockByUUID(blockId) as IPolicyInterfaceBlock).setData(userFull, data)
                res.send(new MessageResponse(result));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.BLOCK_BY_TAG, async (msg, res) => {
            try {
                const { user, tag, policyId } = msg.payload;
                const userFull = await this.users.getUser(user.username);
                const block = PolicyComponentsUtils.GetBlockByTag(policyId, tag);
                res.send(new MessageResponse({ id: block.uuid }));
            } catch (error) {
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.GET_BLOCK_PARENTS, async (msg, res) => {
            try {
                const { user, blockId, policyId, data } = msg.payload;
                const userFull = await this.users.getUser(user.username);
                const block = PolicyComponentsUtils.GetBlockByUUID(blockId) as IPolicyInterfaceBlock;
                let tmpBlock: IPolicyBlock = block;
                const parents = [block.uuid];
                while (tmpBlock.parent) {
                    parents.push(tmpBlock.parent.uuid);
                    tmpBlock = tmpBlock.parent;
                }
                res.send(new MessageResponse(parents));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.POLICY_EXPORT_FILE, async (msg, res) => {
            try {
                const { policyId } = msg.payload;
                const policy = await getMongoRepository(Policy).findOne(policyId);
                if (!policy) {
                    throw new Error(`Cannot export policy ${policyId}`);
                }
                const zip = await PolicyImportExportHelper.generateZipFile(policy);
                const file = await zip.generateAsync({ type: 'arraybuffer' });
                res.send(file, 'raw');
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                console.log(error);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.POLICY_EXPORT_MESSAGE, async (msg, res) => {
            try {
                const { policyId } = msg.payload;
                const policy = await getMongoRepository(Policy).findOne(policyId);
                if (!policy) {
                    throw new Error(`Cannot export policy ${policyId}`);
                }
                res.send(new MessageResponse({
                    id: policy.id,
                    name: policy.name,
                    description: policy.description,
                    version: policy.version,
                    messageId: policy.messageId,
                    owner: policy.owner
                }));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.POLICY_IMPORT_FILE_PREVIEW, async (msg, res) => {
            try {
                const { zip, user } = msg.payload;
                if (!zip) {
                    throw new Error('file in body is empty');
                }
                const userFull = await this.users.getUser(user.username);
                const policyToImport = await PolicyImportExportHelper.parseZipFile(Buffer.from(zip.data));
                res.send(new MessageResponse(policyToImport));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.POLICY_IMPORT_FILE, async (msg, res) => {
            try {
                const { zip, user } = msg.payload;
                if (!zip) {
                    throw new Error('file in body is empty');
                }
                const userFull = await this.users.getUser(user.username);
                const policyToImport = await PolicyImportExportHelper.parseZipFile(Buffer.from(zip.data));
                const policy = await PolicyImportExportHelper.importPolicy(policyToImport, userFull.did);
                const policies = await getMongoRepository(Policy).find({ owner: userFull.did });
                res.send(new MessageResponse(policies));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.POLICY_IMPORT_MESSAGE_PREVIEW, async (msg, res) => {
            try {
                const { messageId, user } = msg.payload;
                const userFull = await this.users.getUser(user.username);
                if (!messageId) {
                    throw new Error('Policy ID in body is empty');
                }

                const root = await this.users.getHederaAccount(userFull.did);
                const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey);
                const message = await messageServer.getMessage<PolicyMessage>(messageId);

                if (message.type !== MessageType.InstancePolicy) {
                    throw new Error('Invalid Message Type');
                }

                if (!message.document) {
                    throw new Error('file in body is empty');
                }

                const newVersions: any = [];
                if (message.version) {
                    const anotherVersions = await messageServer.getMessages<PolicyMessage>(
                        message.getTopicId(), MessageType.InstancePolicy, MessageAction.PublishPolicy
                    );
                    for (let i = 0; i < anotherVersions.length; i++) {
                        let element = anotherVersions[i];
                        if (element.version && ModelHelper.versionCompare(element.version, message.version) === 1) {
                            newVersions.push({
                                messageId: element.getId(),
                                version: element.version
                            });
                        }
                    };
                }

                const policyToImport = await PolicyImportExportHelper.parseZipFile(message.document);
                if (newVersions.length !== 0) {
                    policyToImport.newVersions = newVersions.reverse();
                }

                res.send(new MessageResponse(policyToImport));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.POLICY_IMPORT_MESSAGE, async (msg, res) => {
            try {
                const { messageId, user } = msg.payload;
                const userFull = await this.users.getUser(user.username);
                if (!messageId) {
                    throw new Error('Policy ID in body is empty');
                }

                const root = await this.users.getHederaAccount(userFull.did);
                const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey);
                const message = await messageServer.getMessage<PolicyMessage>(messageId);

                if (message.type !== MessageType.InstancePolicy) {
                    throw new Error('Invalid Message Type');
                }

                if (!message.document) {
                    throw new Error('file in body is empty');
                }

                const policyToImport = await PolicyImportExportHelper.parseZipFile(message.document);
                const policy = await PolicyImportExportHelper.importPolicy(policyToImport, userFull.did);
                const policies = await getMongoRepository(Policy).find({ owner: userFull.did });
                res.send(new MessageResponse(policies));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });

        this.channel.response(PolicyEngineEvents.RECEIVE_EXTERNAL_DATA, async (msg, res) => {
            try {
                await PolicyComponentsUtils.ReceiveExternalData(msg.payload);
                res.send(new MessageResponse(true));
            } catch (error) {
                new Logger().error(error.toString(), ['GUARDIAN_SERVICE']);
                res.send(new MessageError(error.message));
            }
        });
    }
}
