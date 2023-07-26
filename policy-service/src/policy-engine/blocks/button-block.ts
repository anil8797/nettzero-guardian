import { EventBlock } from '@policy-engine/helpers/decorators';
import { PolicyComponentsUtils } from '@policy-engine/policy-components-utils';
import { PolicyValidationResultsContainer } from '@policy-engine/policy-validation-results-container';
import { IPolicyAddonBlock, IPolicyInterfaceBlock } from '@policy-engine/policy-engine.interface';
import { ChildrenType, ControlType } from '@policy-engine/interfaces/block-about';
import { PolicyInputEventType } from '@policy-engine/interfaces';
import { IPolicyUser } from '@policy-engine/policy-user';
import { PolicyUtils } from '@policy-engine/helpers/utils';
import { ExternalDocuments, ExternalEvent, ExternalEventType } from '@policy-engine/interfaces/external-event';

/**
 * Document Buttons with UI
 */
@EventBlock({
    blockType: 'buttonBlock',
    commonBlock: false,
    about: {
        label: 'Button',
        title: `Add 'Button' Block`,
        post: true,
        get: true,
        children: ChildrenType.Special,
        control: ControlType.UI,
        input: [
            PolicyInputEventType.RunEvent
        ],
        output: null,
        defaultEvent: false
    }
})
export class ButtonBlock {
    /**
     * Get block data
     * @param user
     */
    async getData(user: IPolicyUser): Promise<any> {
        const ref = PolicyComponentsUtils.GetBlockRef<IPolicyAddonBlock>(this);
        const data: any = {
            id: ref.uuid,
            blockType: ref.blockType,
            type: ref.options.type,
            uiMetaData: ref.options.uiMetaData,
            user: ref.options.user
        }
        return data;
    }

    /**
     * Set block data
     * @param user
     * @param blockData
     */
    async setData(user: IPolicyUser, blockData: {
        /**
         * Document
         */
        document: any,
        /**
         * Tag
         */
        tag: any
    }): Promise<any> {
        const ref = PolicyComponentsUtils.GetBlockRef<IPolicyInterfaceBlock>(this);

        ref.triggerEvents(blockData.tag, user, { data: blockData.document });
        PolicyComponentsUtils.ExternalEventFn(new ExternalEvent(ExternalEventType.Set, ref, user, {
            button: blockData.tag,
            documents: ExternalDocuments(blockData.document)
        }));
    }

    /**
     * Validate block options
     * @param resultsContainer
     */
    public async validate(resultsContainer: PolicyValidationResultsContainer): Promise<void> {
        const ref = PolicyComponentsUtils.GetBlockRef(this);
        try {
            if (!ref.options.uiMetaData || (typeof ref.options.uiMetaData !== 'object')) {
                resultsContainer.addBlockError(ref.uuid, 'Option "uiMetaData" does not set');
            } else {
                if (Array.isArray(ref.options.uiMetaData.buttons)) {
                    for (const button of ref.options.uiMetaData.buttons) {
                        if (!button.tag) {
                            resultsContainer.addBlockError(ref.uuid, 'Option "tag" does not set');
                        }
                        if (Array.isArray(button.filters)) {
                            for (const filter of button.filters) {
                                if (!filter.type) {
                                    resultsContainer.addBlockError(ref.uuid, 'Option "type" does not set');
                                }
                                if (!filter.field) {
                                    resultsContainer.addBlockError(ref.uuid, 'Option "field" does not set');
                                }
                            }
                        }
                        else {
                            resultsContainer.addBlockError(ref.uuid, 'Option "button.filters" must be an array');
                        }
                        switch (button.type) {
                            case 'selector':
                                break;
                            case 'selector-dialog':
                                if (!button.title) {
                                    resultsContainer.addBlockError(ref.uuid, 'Option "title" does not set');
                                }
                                if (!button.description) {
                                    resultsContainer.addBlockError(ref.uuid, 'Option "description" does not set');
                                }
                                break;
                            default:
                                resultsContainer.addBlockError(ref.uuid, 'Option "type" must be a "selector|selector-dialog"');
                        }
                    }
                } else {
                    resultsContainer.addBlockError(ref.uuid, 'Option "uiMetaData.buttons" must be an array');
                }
            }
        } catch (error) {
            resultsContainer.addBlockError(ref.uuid, `Unhandled exception ${PolicyUtils.getErrorMessage(error)}`);
        }
    }
}
