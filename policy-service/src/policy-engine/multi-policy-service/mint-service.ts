import { Token } from '@entity/token';
import { AnyBlockType } from '@policy-engine/policy-engine.interface';
import {
    ExternalMessageEvents,
    GenerateUUIDv4,
    IRootConfig,
    WorkerTaskType
} from '@guardian/interfaces';
import { ExternalEventChannel, Logger } from '@guardian/common';
import { PrivateKey } from '@hashgraph/sdk';
import { KeyType, Wallet } from '@helpers/wallet';
import { Workers } from '@helpers/workers';
import { PolicyUtils } from '@policy-engine/helpers/utils';
import { IPolicyUser } from '@policy-engine/policy-user';
import { DatabaseServer } from '@database-modules';
import { MultiPolicy } from '@entity/multi-policy';
import { MessageAction, MessageServer, SynchronizationMessage, TopicConfig, VcDocument } from '@hedera-modules';

/**
 * Token Config
 */
interface TokenConfig {
    /**
     * Treasury Account Id
     */
    treasuryId: any;
    /**
     * Token ID
     */
    tokenId: any;
    /**
     * Supply Key
     */
    supplyKey: string;
    /**
     * Treasury Account Key
     */
    treasuryKey: string;
}

/**
 * Mint Service
 */
export class MintService {
    /**
     * Wallet service
     */
    private static readonly wallet = new Wallet();
    /**
     * Logger service
     */
    private static readonly logger = new Logger();

    /**
     * Mint Non Fungible Tokens
     * @param token
     * @param tokenValue
     * @param root
     * @param targetAccount
     * @param uuid
     * @param transactionMemo
     * @param ref
     */
    private static async mintNonFungibleTokens(
        token: TokenConfig,
        tokenValue: number,
        root: IRootConfig,
        targetAccount: string,
        uuid: string,
        transactionMemo: string,
        ref?: AnyBlockType,
    ) {
        const mintId = Date.now();
        MintService.log(`Mint(${mintId}): Start (Count: ${tokenValue})`, ref);

        const workers = new Workers();
        const data = new Array<string>(Math.floor(tokenValue));
        data.fill(uuid);
        const serials: number[] = [];
        const dataChunk = PolicyUtils.splitChunk(data, 10);
        const mintPromiseArray: Promise<any>[] = [];
        for (let i = 0; i < dataChunk.length; i++) {
            const metaData = dataChunk[i];
            if (i % 100 === 0) {
                MintService.log(`Mint(${mintId}): Minting (Chunk: ${i + 1}/${dataChunk.length})`, ref);
            }

            mintPromiseArray.push(workers.addRetryableTask({
                type: WorkerTaskType.MINT_NFT,
                data: {
                    hederaAccountId: root.hederaAccountId,
                    hederaAccountKey: root.hederaAccountKey,
                    dryRun: ref && ref.dryRun,
                    tokenId: token.tokenId,
                    supplyKey: token.supplyKey,
                    metaData,
                    transactionMemo
                }
            }, 1));

        }
        try {
            for (const newSerials of await Promise.all(mintPromiseArray)) {
                for (const serial of newSerials) {
                    serials.push(serial)
                }
            }
        } catch (error) {
            MintService.error(`Mint(${mintId}): Mint Error (${PolicyUtils.getErrorMessage(error)})`, ref);
        }

        MintService.log(`Mint(${mintId}): Minted (Count: ${serials.length})`, ref);
        MintService.log(`Mint(${mintId}): Transfer ${token.treasuryId} -> ${targetAccount} `, ref);

        const serialsChunk = PolicyUtils.splitChunk(serials, 10);
        const transferPromiseArray: Promise<any>[] = [];
        for (let i = 0; i < serialsChunk.length; i++) {
            const element = serialsChunk[i];
            if (i % 100 === 0) {
                MintService.log(`Mint(${mintId}): Transfer (Chunk: ${i + 1}/${serialsChunk.length})`, ref);
            }
            transferPromiseArray.push(workers.addRetryableTask({
                type: WorkerTaskType.TRANSFER_NFT,
                data: {
                    hederaAccountId: root.hederaAccountId,
                    hederaAccountKey: root.hederaAccountKey,
                    dryRun: ref && ref.dryRun,
                    tokenId: token.tokenId,
                    targetAccount,
                    treasuryId: token.treasuryId,
                    treasuryKey: token.treasuryKey,
                    element,
                    transactionMemo
                }
            }, 1));

        }
        try {
            await Promise.all(transferPromiseArray);
        } catch (error) {
            MintService.error(`Mint(${mintId}): Transfer Error (${PolicyUtils.getErrorMessage(error)})`, ref);
        }

        MintService.log(`Mint(${mintId}): End`, ref);
    }

    /**
     * Mint Fungible Tokens
     * @param token
     * @param tokenValue
     * @param root
     * @param targetAccount
     * @param uuid
     * @param transactionMemo
     * @param ref
     */
    private static async mintFungibleTokens(
        token: TokenConfig,
        tokenValue: number,
        root: IRootConfig,
        targetAccount: string,
        uuid: string,
        transactionMemo: string,
        ref?: AnyBlockType,
    ) {
        const mintId = Date.now();
        MintService.log(`Mint(${mintId}): Start (Count: ${tokenValue})`, ref);

        try {
            const workers = new Workers();
            await workers.addRetryableTask({
                type: WorkerTaskType.MINT_FT,
                data: {
                    hederaAccountId: root.hederaAccountId,
                    hederaAccountKey: root.hederaAccountKey,
                    dryRun: ref && ref.dryRun,
                    tokenId: token.tokenId,
                    supplyKey: token.supplyKey,
                    tokenValue,
                    transactionMemo
                }
            }, 1);
            await workers.addRetryableTask({
                type: WorkerTaskType.TRANSFER_FT,
                data: {
                    hederaAccountId: root.hederaAccountId,
                    hederaAccountKey: root.hederaAccountKey,
                    dryRun: ref && ref.dryRun,
                    tokenId: token.tokenId,
                    targetAccount,
                    treasuryId: token.treasuryId,
                    treasuryKey: token.treasuryKey,
                    tokenValue,
                    transactionMemo
                }
            }, 1);
        } catch (error) {
            MintService.error(`Mint FT(${mintId}): Mint/Transfer Error (${PolicyUtils.getErrorMessage(error)})`, ref);
        }

        MintService.log(`Mint(${mintId}): End`, ref);
    }

    /**
     * Get token keys
     * @param ref
     * @param token
     */
    private static async getTokenConfig(ref: AnyBlockType, token: Token): Promise<TokenConfig> {
        const tokenConfig: TokenConfig = {
            treasuryId: token.adminId,
            tokenId: token.tokenId,
            supplyKey: null,
            treasuryKey: null
        }
        if (ref.dryRun) {
            const tokenPK = PrivateKey.generate().toString();
            tokenConfig.supplyKey = tokenPK;
            tokenConfig.treasuryKey = tokenPK;
        } else {
            const [treasuryKey, supplyKey] = await Promise.all([
                MintService.wallet.getUserKey(
                    token.owner,
                    KeyType.TOKEN_TREASURY_KEY,
                    token.tokenId
                ),
                MintService.wallet.getUserKey(
                    token.owner,
                    KeyType.TOKEN_SUPPLY_KEY,
                    token.tokenId
                ),
            ]);
            tokenConfig.supplyKey = supplyKey;
            tokenConfig.treasuryKey = treasuryKey;
        }
        return tokenConfig;
    }

    /**
     * Send Synchronization Message
     * @param ref
     * @param multipleConfig
     * @param root
     * @param data
     */
    private static async sendMessage(
        ref: AnyBlockType,
        multipleConfig: MultiPolicy,
        root: IRootConfig,
        data: any
    ) {
        const message = new SynchronizationMessage(MessageAction.Mint);
        message.setDocument(multipleConfig, data);
        const messageServer = new MessageServer(root.hederaAccountId, root.hederaAccountKey, ref.dryRun);
        const topic = new TopicConfig({ topicId: multipleConfig.synchronizationTopicId }, null, null);
        await messageServer
            .setTopicObject(topic)
            .sendMessage(message);
    }

    /**
     * Mint
     * @param ref
     * @param token
     * @param tokenValue
     * @param documentOwner
     * @param root
     * @param targetAccount
     * @param uuid
     */
    public static async mint(
        ref: AnyBlockType,
        token: Token,
        tokenValue: number,
        documentOwner: IPolicyUser,
        root: IRootConfig,
        targetAccount: string,
        uuid: string,
        transactionMemo: string,
        documents: VcDocument[]
    ): Promise<void> {
        const multipleConfig = await MintService.getMultipleConfig(ref, documentOwner);
        if (multipleConfig) {
            const hash = VcDocument.toCredentialHash(documents, (value: any) => {
                delete value.id;
                delete value.policyId;
                delete value.ref;
                return value;
            });
            await MintService.sendMessage(ref, multipleConfig, root, {
                hash,
                messageId: uuid,
                tokenId: token.tokenId,
                amount: tokenValue,
                memo: transactionMemo,
                target: targetAccount
            });
            if (multipleConfig.type === 'Main') {
                const user = await PolicyUtils.getHederaAccount(ref, documentOwner.did);
                await DatabaseServer.createMultiPolicyTransaction({
                    uuid: GenerateUUIDv4(),
                    policyId: ref.policyId,
                    owner: documentOwner.did,
                    user: user.hederaAccountId,
                    hash,
                    tokenId: token.tokenId,
                    amount: tokenValue,
                    target: targetAccount,
                    status: 'Waiting'
                });
            }
        } else {
            const tokenConfig = await MintService.getTokenConfig(ref, token);
            if (token.tokenType === 'non-fungible') {
                await MintService.mintNonFungibleTokens(
                    tokenConfig, tokenValue, root, targetAccount, uuid, transactionMemo, ref
                );
            } else {
                await MintService.mintFungibleTokens(
                    tokenConfig, tokenValue, root, targetAccount, uuid, transactionMemo, ref
                );
            }
        }

        new ExternalEventChannel().publishMessage(
            ExternalMessageEvents.TOKEN_MINTED,
            {
                tokenId: token.tokenId,
                tokenValue,
                memo: transactionMemo
            }
        );
    }

    /**
     * Mint
     * @param ref
     * @param token
     * @param tokenValue
     * @param documentOwner
     * @param root
     * @param targetAccount
     * @param uuid
     */
    public static async multiMint(
        root: IRootConfig,
        token: Token,
        tokenValue: number,
        targetAccount: string,
        ids: string[]
    ): Promise<void> {
        const memo = ids.join(',');
        const tokenConfig: TokenConfig = {
            treasuryId: token.adminId,
            tokenId: token.tokenId,
            supplyKey: null,
            treasuryKey: null
        }
        const [treasuryKey, supplyKey] = await Promise.all([
            MintService.wallet.getUserKey(
                token.owner,
                KeyType.TOKEN_TREASURY_KEY,
                token.tokenId
            ),
            MintService.wallet.getUserKey(
                token.owner,
                KeyType.TOKEN_SUPPLY_KEY,
                token.tokenId
            ),
        ]);
        tokenConfig.supplyKey = supplyKey;
        tokenConfig.treasuryKey = treasuryKey;

        if (token.tokenType === 'non-fungible') {
            await MintService.mintNonFungibleTokens(
                tokenConfig, tokenValue, root, targetAccount, memo, memo
            );
        } else {
            await MintService.mintFungibleTokens(
                tokenConfig, tokenValue, root, targetAccount, memo, memo
            );
        }

        new ExternalEventChannel().publishMessage(
            ExternalMessageEvents.TOKEN_MINTED,
            {
                tokenId: token.tokenId,
                tokenValue,
                memo
            }
        );
    }

    /**
     * Wipe
     * @param token
     * @param tokenValue
     * @param root
     * @param targetAccount
     * @param uuid
     */
    public static async wipe(
        ref: AnyBlockType,
        token: Token,
        tokenValue: number,
        root: IRootConfig,
        targetAccount: string,
        uuid: string
    ): Promise<void> {
        const workers = new Workers();
        const wipeKey = await MintService.wallet.getUserKey(
            token.owner,
            KeyType.TOKEN_WIPE_KEY,
            token.tokenId
        );
        await workers.addRetryableTask({
            type: WorkerTaskType.WIPE_TOKEN,
            data: {
                hederaAccountId: root.hederaAccountId,
                hederaAccountKey: root.hederaAccountKey,
                dryRun: ref.dryRun,
                token,
                wipeKey,
                targetAccount,
                tokenValue,
                uuid
            }
        }, 1);
    }

    /**
     * Get Multiple Link
     * @param ref
     * @param documentOwner
     */
    private static async getMultipleConfig(ref: AnyBlockType, documentOwner: IPolicyUser) {
        return await DatabaseServer.getMultiPolicy(ref.policyInstance.instanceTopicId, documentOwner.did);
    }

    /**
     * Write log message
     * @param message
     */
    public static log(message: string, ref?: AnyBlockType,) {
        if (ref) {
            MintService.logger.info(message, ['GUARDIAN_SERVICE', ref.uuid, ref.blockType, ref.tag, ref.policyId]);
        } else {
            MintService.logger.info(message, ['GUARDIAN_SERVICE']);
        }

    }

    /**
     * Write error message
     * @param message
     */
    public static error(message: string, ref?: AnyBlockType,) {
        if (ref) {
            MintService.logger.error(message, ['GUARDIAN_SERVICE', ref.uuid, ref.blockType, ref.tag, ref.policyId]);
        } else {
            MintService.logger.error(message, ['GUARDIAN_SERVICE']);
        }

    }

    /**
     * Write warn message
     * @param message
     */
    public static warn(message: string, ref?: AnyBlockType,) {
        if (ref) {
            MintService.logger.warn(message, ['GUARDIAN_SERVICE', ref.uuid, ref.blockType, ref.tag, ref.policyId]);
        } else {
            MintService.logger.warn(message, ['GUARDIAN_SERVICE']);
        }

    }
}