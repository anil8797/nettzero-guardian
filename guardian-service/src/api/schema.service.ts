import { Schema as SchemaCollection } from '@entity/schema';
import {
    ISchema,
    MessageAPI,
    SchemaEntity,
    SchemaStatus,
    TopicType,
    SchemaHelper,
    ModelHelper,
    GenerateUUIDv4,
    Schema,
    IRootConfig,
} from '@guardian/interfaces';
import path from 'path';
import { readJSON } from 'fs-extra';
import { schemasToContext } from '@transmute/jsonld-schema';
import { MessageAction, MessageServer, MessageType, SchemaMessage, TopicConfig, TopicHelper, UrlType } from '@hedera-modules';
import { replaceValueRecursive } from '@helpers/utils';
import { Users } from '@helpers/users';
import { ApiResponse } from '@api/api-response';
import { MessageBrokerChannel, MessageResponse, MessageError, Logger, RunFunctionAsync } from '@guardian/common';
import { DatabaseServer } from '@database-modules';
import { emptyNotifier, initNotifier, INotifier } from '@helpers/notifier';
import { SchemaConverterUtils } from '@helpers/schema-converter-utils';

export const schemaCache = {};

/**
 * Creation of default schemas.
 */
export async function setDefaultSchema() {
    const fileConfig = path.join(process.cwd(), 'system-schemas', 'system-schemas.json');
    let fileContent: any;
    try {
        fileContent = await readJSON(fileConfig);
    } catch (error) {
        throw new Error('you need to create a file \'system-schemas.json\'');
    }

    const map: any = {};
    for (const schema of fileContent) {
        map[schema.entity] = schema;
    }

    if (!map.hasOwnProperty(SchemaEntity.MINT_NFTOKEN)) {
        throw new Error(`You need to fill ${SchemaEntity.MINT_NFTOKEN} field in system-schemas.json file`);
    }

    if (!map.hasOwnProperty(SchemaEntity.MINT_TOKEN)) {
        throw new Error(`You need to fill ${SchemaEntity.MINT_TOKEN} field in system-schemas.json file`);
    }

    if (!map.hasOwnProperty(SchemaEntity.POLICY)) {
        throw new Error(`You need to fill ${SchemaEntity.POLICY} field in system-schemas.json file`);
    }

    if (!map.hasOwnProperty(SchemaEntity.STANDARD_REGISTRY)) {
        throw new Error(`You need to fill ${SchemaEntity.STANDARD_REGISTRY} field in system-schemas.json file`);
    }

    if (!map.hasOwnProperty(SchemaEntity.WIPE_TOKEN)) {
        throw new Error(`You need to fill ${SchemaEntity.WIPE_TOKEN} field in system-schemas.json file`);
    }

    const fn = async (schema: any) => {
        const existingSchemas = await DatabaseServer.getSchema({ uuid: schema.uuid, system: true });
        if (existingSchemas) {
            console.log(`Skip schema: ${schema.uuid}`);
            return;
        }
        schema.owner = null;
        schema.creator = null;
        schema.readonly = true;
        schema.system = true;
        schema.active = true;
        await DatabaseServer.createAndSaveSchema(schema);
        console.log(`Created schema: ${schema.uuid}`);
    }

    await fn(map[SchemaEntity.MINT_NFTOKEN]);
    await fn(map[SchemaEntity.MINT_TOKEN]);
    await fn(map[SchemaEntity.RETIRE_TOKEN]);
    await fn(map[SchemaEntity.POLICY]);
    await fn(map[SchemaEntity.STANDARD_REGISTRY]);
    await fn(map[SchemaEntity.WIPE_TOKEN]);
    await fn(map[SchemaEntity.ISSUER]);
    await fn(map[SchemaEntity.USER_ROLE]);
    await fn(map[SchemaEntity.CHUNK]);
    await fn(map[SchemaEntity.ACTIVITY_IMPACT]);
    await fn(map[SchemaEntity.TOKEN_DATA_SOURCE]);
}

/**
 * Load schema
 * @param messageId
 * @param owner
 */
async function loadSchema(messageId: string, owner: string) {
    const log = new Logger();
    try {
        if (schemaCache[messageId]) {
            return schemaCache[messageId];
        }
        const messageServer = new MessageServer(null, null);
        log.info(`loadSchema: ${messageId}`, ['GUARDIAN_SERVICE']);
        const message = await messageServer.getMessage<SchemaMessage>(messageId, MessageType.Schema);
        log.info(`loadedSchema: ${messageId}`, ['GUARDIAN_SERVICE']);
        const schemaToImport: any = {
            uuid: message.uuid,
            hash: '',
            name: message.name,
            description: message.description,
            entity: message.entity as SchemaEntity,
            status: SchemaStatus.PUBLISHED,
            readonly: false,
            system: false,
            active: false,
            document: message.getDocument(),
            context: message.getContext(),
            version: message.version,
            creator: message.owner,
            owner,
            topicId: message.getTopicId(),
            messageId,
            documentURL: message.getDocumentUrl(UrlType.url),
            contextURL: message.getContextUrl(UrlType.url),
            iri: null,
            codeVersion: message.codeVersion
        }
        SchemaHelper.updateIRI(schemaToImport);
        log.info(`loadSchema end: ${messageId}`, ['GUARDIAN_SERVICE']);
        schemaCache[messageId] = { ...schemaToImport };
        return schemaToImport;
    } catch (error) {
        log.error(error, ['GUARDIAN_SERVICE']);
        throw new Error(`Cannot load schema ${messageId}`);
    }
}

/**
 * Get defs
 * @param schema
 */
function getDefs(schema: ISchema) {
    try {
        let document: any = schema.document;
        if (typeof document === 'string') {
            document = JSON.parse(document);
        }
        if (!document.$defs) {
            return [];
        }
        return Object.keys(document.$defs);
    } catch (error) {
        return [];
    }
}

/**
 * Only unique
 * @param value
 * @param index
 * @param self
 */
function onlyUnique(value: any, index: any, self: any): boolean {
    return self.indexOf(value) === index;
}

/**
 * Check circular dependency in schema
 * @param schema Schema
 * @returns Does circular dependency exists
 */
function checkForCircularDependency(schema: ISchema) {
    return schema.document?.$defs && schema.document.$id
        ? Object.keys(schema.document.$defs).includes(schema.document.$id)
        : false;
}

/**
 * Increment schema version
 * @param iri
 * @param owner
 */
export async function incrementSchemaVersion(iri: string, owner: string): Promise<SchemaCollection> {
    if (!owner || !iri) {
        throw new Error(`Invalid increment schema version parameter`);
    }

    const schema = await DatabaseServer.getSchema({ iri, owner });

    if (!schema) {
        return;
    }

    if (schema.status === SchemaStatus.PUBLISHED) {
        return schema;
    }

    const { previousVersion } = SchemaHelper.getVersion(schema);
    let newVersion = '1.0.0';
    if (previousVersion) {
        const schemas = await DatabaseServer.getSchemas({ uuid: schema.uuid });
        const versions = [];
        for (const element of schemas) {
            const elementVersions = SchemaHelper.getVersion(element);
            versions.push(elementVersions.version, elementVersions.previousVersion);
        }
        newVersion = SchemaHelper.incrementVersion(previousVersion, versions);
    }
    schema.version = newVersion;

    return schema;
}

/**
 * Create schema
 * @param newSchema
 * @param owner
 */
async function createSchema(newSchema: ISchema, owner: string, notifier: INotifier): Promise<SchemaCollection> {
    if (checkForCircularDependency(newSchema)) {
        throw new Error(`There is circular dependency in schema: ${newSchema.iri}`);
    }
    delete newSchema.id;
    delete newSchema._id;
    const users = new Users();
    notifier.start('Resolve Hedera account');
    const root = await users.getHederaAccount(owner);
    notifier.completedAndStart('Save in DB');
    if (newSchema) {
        delete newSchema.status;
    }
    const schemaObject = DatabaseServer.createSchema(newSchema);
    notifier.completedAndStart('Resolve Topic');
    let topic: TopicConfig;
    if (newSchema.topicId) {
        topic = await TopicConfig.fromObject(await DatabaseServer.getTopicById(newSchema.topicId), true);
    }

    if (!topic) {
        const topicHelper = new TopicHelper(root.hederaAccountId, root.hederaAccountKey);
        topic = await topicHelper.create({
            type: TopicType.SchemaTopic,
            name: TopicType.SchemaTopic,
            description: TopicType.SchemaTopic,
            owner,
            policyId: null,
            policyUUID: null
        });
        await topic.saveKeys();
        await DatabaseServer.saveTopic(topic.toObject());
        await topicHelper.twoWayLink(topic, null, null);
    }

    SchemaHelper.updateIRI(schemaObject);
    schemaObject.status = SchemaStatus.DRAFT;
    schemaObject.topicId = topic.topicId;
    schemaObject.iri = schemaObject.iri || `${schemaObject.uuid}`;
    schemaObject.codeVersion = SchemaConverterUtils.VERSION;
    const errorsCount = await DatabaseServer.getSchemasCount({
        where: {
            iri: {
                $eq: schemaObject.iri
            },
            $or: [
                {
                    topicId: {
                        $ne: schemaObject.topicId
                    }
                },
                {
                    uuid: {
                        $ne: schemaObject.uuid
                    }
                }
            ]
        }
    });
    if (errorsCount > 0) {
        throw new Error('Schema identifier already exist');
    }

    notifier.completedAndStart('Save to IPFS & Hedera');
    const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey);
    const message = new SchemaMessage(MessageAction.CreateSchema);
    message.setDocument(schemaObject);
    await messageServer.setTopicObject(topic).sendMessage(message);

    notifier.completedAndStart('Update schema in DB');
    const savedSchema = await DatabaseServer.saveSchema(schemaObject);
    notifier.completed();
    return savedSchema;
}

/**
 * Import schema by files
 * @param owner
 * @param files
 * @param topicId
 */
export async function importSchemaByFiles(
    owner: string,
    files: ISchema[],
    topicId: string,
    notifier: INotifier
): Promise<{
    /**
     * New schema uuid
     */
    schemasMap: any[];
    /**
     * Errors
     */
    errors: any[];
}> {
    notifier.start('Import schemas');
    const uuidMap: Map<string, string> = new Map();
    for (const file of files) {
        const newUUID = GenerateUUIDv4();
        const uuid = file.iri ? file.iri.substring(1) : null;
        if (uuid) {
            uuidMap.set(uuid, newUUID);
        }
        file.uuid = newUUID;
        file.iri = '#' + newUUID;
        file.documentURL = null;
        file.contextURL = null;
        file.messageId = null;
        file.creator = owner;
        file.owner = owner;
        file.topicId = topicId;
        file.status = SchemaStatus.DRAFT;
    }

    notifier.info(`Found ${files.length} schemas`);
    for (const file of files) {
        file.document = replaceValueRecursive(file.document, uuidMap);
        file.context = replaceValueRecursive(file.context, uuidMap);
        SchemaHelper.setVersion(file, '', '');
    }

    const parsedSchemas = files.map(item => new Schema(item, true));
    const updatedSchemasMap = {};
    const errors: any[] = [];
    for (const file of files) {
        const valid = fixSchemaDefsOnImport(file.iri, parsedSchemas, updatedSchemasMap);
        if (!valid) {
            errors.push({
                uuid: file.uuid,
                name: file.name,
                error: 'invalid defs'
            });
        }
    }

    let num: number = 0;
    for (let file of files) {
        const parsedSchema = updatedSchemasMap[file.iri];
        file.document = parsedSchema.document;
        file = SchemaConverterUtils.SchemaConverter(file);
        await createSchema(file, owner, emptyNotifier());
        num++;
        notifier.info(`Schema ${num} (${file.name || '-'}) created`);
    }

    const schemasMap: any[] = [];
    uuidMap.forEach((v, k) => {
        schemasMap.push({
            oldUUID: k,
            newUUID: v,
            oldIRI: `#${k}`,
            newIRI: `#${v}`
        })
    });

    notifier.completed();
    return { schemasMap, errors };
}

/**
 * Publish schema
 * @param item
 * @param version
 * @param messageServer
 * @param type
 */
export async function publishSchema(
    item: SchemaCollection,
    messageServer: MessageServer,
    type?: MessageAction
): Promise<SchemaCollection> {
    if (checkForCircularDependency(item)) {
        throw new Error(`There is circular dependency in schema: ${item.iri}`);
    }
    const itemDocument = item.document;
    const defsArray = itemDocument.$defs ? Object.values(itemDocument.$defs) : [];

    const names = Object.keys(itemDocument.properties);
    for (const name of names) {
        const field = SchemaHelper.parseProperty(name, itemDocument.properties[name]);
        if (!field.type) {
            throw new Error(`Field type not set. Field: ${name}`);
        }
        if (field.isRef && (!itemDocument.$defs || !itemDocument.$defs[field.type])) {
            throw new Error(`Dependent schema not found: ${item.iri}. Field: ${name}`);
        }
    }

    item.context = schemasToContext([...defsArray, itemDocument]);

    const message = new SchemaMessage(type || MessageAction.PublishSchema);
    message.setDocument(item);
    const result = await messageServer
        .sendMessage(message);

    const messageId = result.getId();
    const topicId = result.getTopicId();
    const contextUrl = result.getContextUrl(UrlType.url);
    const documentUrl = result.getDocumentUrl(UrlType.url);

    item.status = SchemaStatus.PUBLISHED;
    item.documentURL = documentUrl;
    item.contextURL = contextUrl;
    item.messageId = messageId;
    item.topicId = topicId;

    SchemaHelper.updateIRI(item);

    return item;
}

/**
 * Publish system schema
 * @param item
 * @param messageServer
 * @param type
 * @param notifier
 */
export async function publishSystemSchema(
    item: SchemaCollection,
    messageServer: MessageServer,
    type?: MessageAction,
    notifier?: INotifier
): Promise<SchemaCollection> {
    delete item.id;
    delete item._id;
    item.readonly = true;
    item.system = false;
    item.active = false;
    item.version = undefined;
    item.topicId = messageServer.getTopic();
    SchemaHelper.setVersion(item, undefined, undefined);
    const result = await publishSchema(item, messageServer, type);
    if (notifier) {
        notifier.info(`Schema ${result.name || '-'} published`);
    }
    return result;
}

/**
 * Publish system schemas
 * @param systemSchemas
 * @param messageServer
 * @param owner
 * @param notifier
 */
export async function publishSystemSchemas(
    systemSchemas: SchemaCollection[],
    messageServer: MessageServer,
    owner: string,
    notifier: INotifier
): Promise<void> {
    const tasks = [];
    for (const schema of systemSchemas) {
        if (schema) {
            schema.creator = owner;
            schema.owner = owner;
            tasks.push(publishSystemSchema(
                schema,
                messageServer,
                MessageAction.PublishSystemSchema,
                notifier
            ));
        }
    }
    const items = await Promise.all(tasks);
    for (const schema of items) {
        await DatabaseServer.createAndSaveSchema(schema);
    }
}

/**
 * Update defs in related schemas
 * @param schemaId Schema id
 */
async function updateSchemaDefs(schemaId: string, oldSchemaId?: string) {
    if (!schemaId) {
        return;
    }

    const schema = await DatabaseServer.getSchema({ 'document.$id': schemaId });
    if (!schema) {
        throw new Error(`Can not find schema ${schemaId}`);
    }

    const schemaDocument = schema.document;
    if (!schemaDocument) {
        return;
    }

    const schemaDefs = schema.document.$defs;
    delete schemaDocument.$defs;

    const filters = {};
    filters[`document.$defs.${oldSchemaId || schemaId}`] = { $exists: true };
    const relatedSchemas = await DatabaseServer.getSchemas(filters);
    for (const rSchema of relatedSchemas) {
        if (oldSchemaId) {
            let document = JSON.stringify(rSchema.document) as string;
            document = document.replaceAll(oldSchemaId.substring(1), schemaId.substring(1));
            rSchema.document = JSON.parse(document);
        }
        rSchema.document.$defs[schemaId] = schemaDocument;
        if (schemaDefs) {
            for (const def of Object.keys(schemaDefs)) {
                rSchema.document.$defs[def] = schemaDefs[def];
            }
        }
    }
    await DatabaseServer.updateSchemas(relatedSchemas);
}

/**
 * Update schema document
 * @param schema Schema
 */
async function updateSchemaDocument(schema: SchemaCollection): Promise<void> {
    if (!schema) {
        throw new Error(`There is no schema to update document`);
    }
    const allSchemasInTopic = await DatabaseServer.getSchemas({
        topicId: schema.topicId,
    });

    const allParsedSchemas = allSchemasInTopic.map(item => new Schema(item));
    const parsedSchema = new Schema(schema, true);
    parsedSchema.update(parsedSchema.fields, parsedSchema.conditions);
    parsedSchema.updateRefs(allParsedSchemas);
    schema.document = parsedSchema.document;
    await DatabaseServer.updateSchema(schema.id, schema);
}

/**
 * Fixing defs in importing schemas
 * @param iri Schema iri
 * @param schemas Schemas
 * @param map Map of updated schemas
 */
function fixSchemaDefsOnImport(iri: string, schemas: Schema[], map: any): boolean {
    if (map[iri]) {
        return true;
    }
    const schema = schemas.find(s => s.iri === iri);
    if (!schema) {
        return false;
    }
    let valid = true;
    for (const field of schema.fields) {
        if (field.isRef) {
            const fieldValid = fixSchemaDefsOnImport(field.type, schemas, map);
            if (!fieldValid) {
                field.type = null;
            }
            valid = valid && fieldValid;
        }
    }
    schema.update(schema.fields, schema.conditions);
    schema.updateRefs(schemas);
    map[iri] = schema;
    return valid;
}

/**
 * Publishing schemas in defs
 * @param defs Definitions
 * @param owner Owner
 * @param root HederaAccount
 */
export async function publishDefsSchemas(defs: any, owner: string, root: IRootConfig) {
    if (!defs) {
        return;
    }

    const schemasIdsInDocument = Object.keys(defs);
    for (const schemaId of schemasIdsInDocument) {
        let schema = await DatabaseServer.getSchema({
            'document.$id': schemaId
        });
        if (schema && schema.status !== SchemaStatus.PUBLISHED) {
            schema = await incrementSchemaVersion(schema.iri, owner);
            await findAndPublishSchema(schema.id, schema.version, owner, root, emptyNotifier());
        }
    }
}

/**
 * Find and publish schema
 * @param id
 * @param version
 * @param owner
 * @param root
 * @param notifier
 */
export async function findAndPublishSchema(
    id: string,
    version: string,
    owner: string,
    root: IRootConfig,
    notifier: INotifier
): Promise<SchemaCollection> {
    notifier.start('Load schema');

    let item = await DatabaseServer.getSchema(id);
    if (!item) {
        throw new Error(`Schema not found: ${id}`);
    }
    if (item.creator !== owner) {
        throw new Error('Invalid owner');
    }
    if (!item.topicId) {
        throw new Error('Invalid topicId');
    }
    if (item.status === SchemaStatus.PUBLISHED) {
        throw new Error('Invalid status');
    }

    notifier.completedAndStart('Publishing related schemas');
    const oldSchemaId = item.document?.$id;
    await publishDefsSchemas(item.document?.$defs, owner, root);
    item = await DatabaseServer.getSchema(id);

    notifier.completedAndStart('Resolve topic');
    const topic = await TopicConfig.fromObject(await DatabaseServer.getTopicById(item.topicId), true);
    const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey)
        .setTopicObject(topic);
    notifier.completedAndStart('Publish schema');

    SchemaHelper.updateVersion(item, version);
    item = await publishSchema(item, messageServer, MessageAction.PublishSchema);

    notifier.completedAndStart('Update in DB');
    await updateSchemaDocument(item);
    await updateSchemaDefs(item.document?.$id, oldSchemaId);
    notifier.completed();
    return item;
}

/**
 * Find and publish schema
 * @param item
 * @param version
 * @param owner
 */
export async function findAndDryRunSchema(item: SchemaCollection, version: string, owner: string): Promise<SchemaCollection> {
    if (item.creator !== owner) {
        throw new Error('Invalid owner');
    }

    if (!item.topicId) {
        throw new Error('Invalid topicId');
    }

    if (item.status === SchemaStatus.PUBLISHED) {
        throw new Error('Invalid status');
    }

    const itemDocument = item.document;
    const defsArray = itemDocument.$defs ? Object.values(itemDocument.$defs) : [];

    const names = Object.keys(itemDocument.properties);
    for (const name of names) {
        const field = SchemaHelper.parseProperty(name, itemDocument.properties[name]);
        if (!field.type) {
            throw new Error(`Field type not set. Field: ${name}`);
        }
        if (field.isRef && (!itemDocument.$defs || !itemDocument.$defs[field.type])) {
            throw new Error(`Dependent schema not found: ${item.iri}. Field: ${name}`);
        }
    }
    item.context = schemasToContext([...defsArray, itemDocument]);
    // item.status = SchemaStatus.PUBLISHED;

    SchemaHelper.updateIRI(item);
    await DatabaseServer.updateSchema(item.id, item);
    return item;
}

/**
 * Import schemas by messages
 * @param owner
 * @param messageIds
 * @param topicId
 * @param notifier
 */
async function importSchemasByMessages(
    owner: string,
    messageIds: string[],
    topicId: string,
    notifier: INotifier
): Promise<{
    /**
     * New schema uuid
     */
    schemasMap: any[];
    /**
     * Errors
     */
    errors: any[];
}> {
    notifier.start('Load schema files');
    const files: ISchema[] = [];
    for (const messageId of messageIds) {
        const newSchema = await loadSchema(messageId, null);
        files.push(newSchema);
    }
    notifier.completed();
    return await importSchemaByFiles(owner, files, topicId, notifier);
}

/**
 * Prepare schema for preview
 * @param messageIds
 * @param notifier
 */
async function prepareSchemaPreview(messageIds: string[], notifier: INotifier): Promise<any[]> {
    notifier.start('Load schema file');
    const result = [];
    for (const messageId of messageIds) {
        const schema = await loadSchema(messageId, null);
        result.push(schema);
    }

    notifier.completedAndStart('Parse schema');
    const messageServer = new MessageServer(null, null);
    const uniqueTopics = result.map(res => res.topicId).filter(onlyUnique);
    const anotherSchemas: SchemaMessage[] = [];
    for (const topicId of uniqueTopics) {
        const anotherVersions = await messageServer.getMessages<SchemaMessage>(
            topicId, MessageType.Schema, MessageAction.PublishSchema
        );
        for (const ver of anotherVersions) {
            anotherSchemas.push(ver);
        }
    }

    notifier.completedAndStart('Verifying');
    for (const schema of result) {
        if (!schema.version) {
            continue;
        }
        const newVersions = [];
        const topicMessages = anotherSchemas.filter(item => item.uuid === schema.uuid);
        for (const topicMessage of topicMessages) {
            if (topicMessage.version &&
                ModelHelper.versionCompare(topicMessage.version, schema.version) === 1) {
                newVersions.push({
                    messageId: topicMessage.getId(),
                    version: topicMessage.version
                });
            }
        }
        if (newVersions && newVersions.length !== 0) {
            schema.newVersions = newVersions.reverse();
        }
    }
    notifier.completed();
    return result;
}

/**
 * Delete schema
 * @param schemaId Schema ID
 * @param notifier Notifier
 */
export async function deleteSchema(schemaId: any, notifier: INotifier) {
    if (!schemaId) {
        return;
    }

    const item = await DatabaseServer.getSchema(schemaId);
    if (!item) {
        throw new Error('Schema not found');
    }
    if (item.status !== SchemaStatus.DRAFT) {
        throw new Error('Schema is not in draft status');
    }

    notifier.info(`Delete schema ${item.name}`);
    if (item.topicId) {
        const topic = await TopicConfig.fromObject(await DatabaseServer.getTopicById(item.topicId), true);
        if (topic) {
            const users = new Users();
            const root = await users.getHederaAccount(item.owner);
            const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey);
            const message = new SchemaMessage(MessageAction.DeleteSchema);
            message.setDocument(item);
            await messageServer.setTopicObject(topic)
                .sendMessage(message);
        }
    }
    await DatabaseServer.deleteSchemas(item.id);
}

/**
 * Connect to the message broker methods of working with schemas.
 *
 * @param channel - channel
 * @param apiGatewayChannel
 */
export async function schemaAPI(channel: MessageBrokerChannel, apiGatewayChannel: MessageBrokerChannel): Promise<void> {

    /**
     * Create schema
     *
     * @param {ISchema} payload - schema
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.CREATE_SCHEMA, async (msg) => {
        try {
            const schemaObject = msg as ISchema;
            SchemaHelper.setVersion(schemaObject, null, schemaObject.version);
            await createSchema(schemaObject, schemaObject.owner, emptyNotifier());
            const schemas = await DatabaseServer.getSchemas(null, { limit: 100 });
            return new MessageResponse(schemas);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    ApiResponse(channel, MessageAPI.CREATE_SCHEMA_ASYNC, async (msg) => {
        const { item, taskId } = msg;
        const notifier = initNotifier(apiGatewayChannel, taskId);
        RunFunctionAsync(async () => {
            const schemaObject = item as ISchema;
            SchemaHelper.setVersion(schemaObject, null, schemaObject.version);
            const schema = await createSchema(schemaObject, schemaObject.owner, notifier);
            notifier.result(schema.id);
        }, async (error) => {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            notifier.error(error);
        });
        return new MessageResponse({ taskId });
    });

    /**
     * Update schema
     *
     * @param {ISchema} payload - schema
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.UPDATE_SCHEMA, async (msg) => {
        try {
            const id = msg.id as string;
            const item = await DatabaseServer.getSchema(id);
            if (item) {
                if (checkForCircularDependency(item)) {
                    throw new Error(`There is circular dependency in schema: ${item.iri}`);
                }
                item.name = msg.name;
                item.description = msg.description;
                item.entity = msg.entity;
                item.document = msg.document;
                item.status = SchemaStatus.DRAFT;
                SchemaHelper.setVersion(item, null, item.version);
                SchemaHelper.updateIRI(item);
                await DatabaseServer.updateSchema(item.id, item);
                await updateSchemaDefs(item.document.$id);
            }
            const schemas = await DatabaseServer.getSchemas(null, { limit: 100 });
            return new MessageResponse(schemas);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    /**
     * Return schema
     *
     * @param {Object} [payload] - filters
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.GET_SCHEMA, async (msg) => {
        try {
            if (!msg) {
                return new MessageError('Invalid load schema parameter');
            }
            if (msg.id) {
                const schema = await DatabaseServer.getSchema(msg.id);
                return new MessageResponse(schema);
            }
            if (msg.type) {
                const iri = `#${msg.type}`;
                const schema = await DatabaseServer.getSchema({
                    iri
                });
                return new MessageResponse(schema);
            }
            return new MessageError('Invalid load schema parameter');
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    /**
     * Return schemas
     *
     * @param {Object} [payload] - filters
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.GET_SCHEMAS, async (msg) => {
        try {
            if (!msg) {
                return new MessageError('Invalid load schema parameter');
            }

            const { owner, uuid, topicId, pageIndex, pageSize } = msg;
            const filter: any = {
                where: {
                    readonly: false,
                    system: false
                }
            }

            if (owner) {
                filter.where.owner = owner;
            }

            if (topicId) {
                filter.where.topicId = topicId;
            }

            if (uuid) {
                filter.where.uuid = uuid;
            }

            const otherOptions: any = {};
            const _pageSize = parseInt(pageSize, 10);
            const _pageIndex = parseInt(pageIndex, 10);
            if (Number.isInteger(_pageSize) && Number.isInteger(_pageIndex)) {
                otherOptions.orderBy = { createDate: 'DESC' };
                otherOptions.limit = Math.min(100, _pageSize);
                otherOptions.offset = _pageIndex * _pageSize;
            } else {
                otherOptions.limit = 100;
            }

            const [schemas, count] = await DatabaseServer.getSchemasAndCount(filter, otherOptions);

            return new MessageResponse({ schemas, count });
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    /**
     * Change the status of a schema on PUBLISHED.
     *
     * @param {Object} payload - filters
     * @param {string} payload.id - schema id
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.PUBLISH_SCHEMA, async (msg) => {
        try {
            if (!msg) {
                return new MessageError('Invalid id');
            }

            const { id, version, owner } = msg;
            const users = new Users();
            const root = await users.getHederaAccount(owner);
            const item = await findAndPublishSchema(id, version, owner, root, emptyNotifier());
            return new MessageResponse(item);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            console.error(error);
            return new MessageError(error);
        }
    });

    ApiResponse(channel, MessageAPI.PUBLISH_SCHEMA_ASYNC, async (msg) => {
        const { id, version, owner, taskId } = msg;
        const notifier = initNotifier(apiGatewayChannel, taskId);
        RunFunctionAsync(async () => {
            if (!msg) {
                notifier.error('Invalid id');
            }

            notifier.completedAndStart('Resolve Hedera account');
            const users = new Users();
            const root = await users.getHederaAccount(owner);
            const item = await findAndPublishSchema(id, version, owner, root, notifier);
            notifier.result(item.id);
        }, async (error) => {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            notifier.error(error);
        });
        return new MessageResponse({ taskId });
    });

    /**
     * Delete a schema.
     *
     * @param {Object} payload - filters
     * @param {string} payload.id - schema id
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.DELETE_SCHEMA, async (msg) => {
        try {
            if (msg && msg.id) {
                await deleteSchema(msg.id, emptyNotifier());
            }
            const schemas = await DatabaseServer.getSchemas(null, { limit: 100 });
            return new MessageResponse(schemas);
        } catch (error) {
            return new MessageError(error);
        }
    });

    /**
     * Load schema by message identifier
     *
     * @param {string} [payload.messageId] Message identifier
     *
     * @returns {Schema} Found or uploaded schema
     */
    ApiResponse(channel, MessageAPI.IMPORT_SCHEMAS_BY_MESSAGES, async (msg) => {
        try {
            if (!msg) {
                return new MessageError('Invalid import schema parameter');
            }
            const { owner, messageIds, topicId } = msg;
            if (!owner || !messageIds) {
                return new MessageError('Invalid import schema parameter');
            }

            const schemasMap = await importSchemasByMessages(owner, messageIds, topicId, emptyNotifier());
            return new MessageResponse(schemasMap);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            console.error(error);
            return new MessageError(error);
        }
    });

    ApiResponse(channel, MessageAPI.IMPORT_SCHEMAS_BY_MESSAGES_ASYNC, async (msg) => {
        const { owner, messageIds, topicId, taskId } = msg;
        const notifier = initNotifier(apiGatewayChannel, taskId);
        RunFunctionAsync(async () => {
            if (!msg) {
                notifier.error('Invalid import schema parameter');
            }
            if (!owner || !messageIds) {
                notifier.error('Invalid import schema parameter');
            }

            const schemasMap = await importSchemasByMessages(owner, messageIds, topicId, notifier);
            notifier.result(schemasMap);
        }, async (error) => {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            notifier.error(error);
        });
        return new MessageResponse({ taskId });
    });

    /**
     * Load schema by files
     *
     * @param {string} [payload.files] files
     *
     * @returns {Schema} Found or uploaded schema
     */
    ApiResponse(channel, MessageAPI.IMPORT_SCHEMAS_BY_FILE, async (msg) => {
        try {
            if (!msg) {
                return new MessageError('Invalid import schema parameter');
            }
            const { owner, files, topicId } = msg;
            if (!owner || !files) {
                return new MessageError('Invalid import schema parameter');
            }

            const result = await importSchemaByFiles(owner, files, topicId, emptyNotifier());
            return new MessageResponse(result);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            console.error(error);
            return new MessageError(error);
        }
    });

    ApiResponse(channel, MessageAPI.IMPORT_SCHEMAS_BY_FILE_ASYNC, async (msg) => {
        const { owner, files, topicId, taskId } = msg;
        const notifier = initNotifier(apiGatewayChannel, taskId);
        RunFunctionAsync(async () => {
            if (!msg) {
                notifier.error('Invalid import schema parameter');
            }
            if (!owner || !files) {
                notifier.error('Invalid import schema parameter');
            }

            const result = await importSchemaByFiles(owner, files, topicId, notifier);
            notifier.result(result);
        }, async (error) => {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            notifier.error(error);
        });
        return new MessageResponse({ taskId });
    });

    /**
     * Preview schema by message identifier
     *
     * @param {string} [payload.messageId] Message identifier
     *
     * @returns {Schema} Found or uploaded schema
     */
    ApiResponse(channel, MessageAPI.PREVIEW_SCHEMA, async (msg) => {
        try {
            if (!msg) {
                return new MessageError('Invalid preview schema parameters');
            }
            const { messageIds } = msg as {
                /**
                 * Message ids
                 */
                messageIds: string[];
            };
            if (!messageIds) {
                return new MessageError('Invalid preview schema parameters');
            }

            const result = await prepareSchemaPreview(messageIds, emptyNotifier());
            return new MessageResponse(result);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            console.error(error);
            return new MessageError(error);
        }
    });

    /**
     * Async preview schema by message identifier
     *
     * @param {string} [payload.messageId] Message identifier
     *
     * @returns {Schema} Found or uploaded schema
     */
    ApiResponse(channel, MessageAPI.PREVIEW_SCHEMA_ASYNC, async (msg) => {
        const { messageIds, taskId } = msg as {
            /**
             * Message ids
             */
            messageIds: string[];
            /**
             * Task id
             */
            taskId: string;
        };
        const notifier = initNotifier(apiGatewayChannel, taskId);
        RunFunctionAsync(async () => {
            if (!msg) {
                notifier.error('Invalid preview schema parameters');
                return;
            }
            if (!messageIds) {
                notifier.error('Invalid preview schema parameters');
                return;
            }

            const result = await prepareSchemaPreview(messageIds, notifier);
            notifier.result(result);
        }, async (error) => {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            notifier.error(error);
        });

        return new MessageResponse({ taskId });
    });

    /**
     * Export schemas
     *
     * @param {Object} payload - filters
     * @param {string[]} payload.ids - schema ids
     *
     * @returns {any} - Response result
     */
    ApiResponse(channel, MessageAPI.EXPORT_SCHEMAS, async (msg) => {
        try {
            const ids = msg as string[];
            const schemas = await DatabaseServer.getSchemasByIds(ids);
            const map: any = {};
            const relationships: ISchema[] = [];
            for (const schema of schemas) {
                if (!map[schema.iri]) {
                    map[schema.iri] = schema;
                    relationships.push(schema);
                    const keys = getDefs(schema);
                    const defs = await DatabaseServer.getSchemas({
                        where: { iri: { $in: keys } }
                    });
                    for (const element of defs) {
                        if (!map[element.iri]) {
                            map[element.iri] = element;
                            relationships.push(element);
                        }
                    }
                }
            }
            return new MessageResponse(relationships);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    ApiResponse(channel, MessageAPI.INCREMENT_SCHEMA_VERSION, async (msg) => {
        try {
            const { owner, iri } = msg as {
                /**
                 * Owner
                 */
                owner: string,
                /**
                 * IRI
                 */
                iri: string
            };
            const schema = await incrementSchemaVersion(iri, owner);
            return new MessageResponse(schema);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    /**
     * Create schema
     *
     * @param {ISchema} payload - schema
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.CREATE_SYSTEM_SCHEMA, async (msg) => {
        try {
            const schemaObject = msg as ISchema;
            SchemaHelper.setVersion(schemaObject, null, null);
            SchemaHelper.updateIRI(schemaObject);
            schemaObject.status = SchemaStatus.DRAFT;
            schemaObject.topicId = null;
            schemaObject.iri = schemaObject.iri || `${schemaObject.uuid}`;
            schemaObject.system = true;
            schemaObject.active = false;
            const item = await DatabaseServer.createAndSaveSchema(schemaObject);
            return new MessageResponse(item);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    /**
     * Return schemas
     *
     * @param {Object} [payload] - filters
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.GET_SYSTEM_SCHEMAS, async (msg) => {
        try {
            if (!msg) {
                return new MessageError('Invalid load schema parameter');
            }

            const { pageIndex, pageSize } = msg;
            const filter: any = {
                where: {
                    system: true
                }
            }
            const otherOptions: any = {};
            const _pageSize = parseInt(pageSize, 10);
            const _pageIndex = parseInt(pageIndex, 10);
            if (Number.isInteger(_pageSize) && Number.isInteger(_pageIndex)) {
                otherOptions.orderBy = { createDate: 'DESC' };
                otherOptions.limit = _pageSize;
                otherOptions.offset = _pageIndex * _pageSize;
            }
            const [schemas, count] = await DatabaseServer.getSchemasAndCount(filter, otherOptions);
            return new MessageResponse({
                schemas,
                count
            });
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    /**
     * Delete a schema.
     *
     * @param {Object} payload - filters
     * @param {string} payload.id - schema id
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.ACTIVE_SCHEMA, async (msg) => {
        try {
            if (msg && msg.id) {
                const item = await DatabaseServer.getSchema(msg.id);
                if (item) {
                    const schemas = await DatabaseServer.getSchemas({
                        entity: item.entity
                    });
                    for (const schema of schemas) {
                        schema.active = schema.id.toString() === item.id.toString();
                    }
                    await DatabaseServer.saveSchemas(schemas);
                }
            }
            return new MessageResponse(null);
        } catch (error) {
            return new MessageError(error);
        }
    });

    /**
     * Return schema
     *
     * @param {Object} [payload] - filters
     *
     * @returns {ISchema[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.GET_SYSTEM_SCHEMA, async (msg) => {
        try {
            if (!msg || !msg.entity) {
                return new MessageError('Invalid load schema parameter');
            }
            const schema = await DatabaseServer.getSchema({
                entity: msg.entity,
                system: true,
                active: true
            });
            return new MessageResponse(schema);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });

    /**
     * Return schemas
     *
     * @param {Object} [payload] - filters
     *
     * @returns {any[]} - all schemas
     */
    ApiResponse(channel, MessageAPI.GET_LIST_SCHEMAS, async (msg) => {
        try {
            if (!msg || !msg.owner) {
                return new MessageError('Invalid schema owner');
            }
            const schema = await DatabaseServer.getSchemas({
                owner: msg.owner,
                system: false,
                readonly: false
            }, {
                fields: [
                    'id',
                    'name',
                    'description',
                    'topicId'
                ]
            });
            return new MessageResponse(schema);
        } catch (error) {
            new Logger().error(error, ['GUARDIAN_SERVICE']);
            return new MessageError(error);
        }
    });
}
