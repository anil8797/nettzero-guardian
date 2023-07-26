import { ApproveStatus, IApprovalDocument, IVC, SchemaEntity } from '@guardian/interfaces';
import { Entity, Property, BeforeCreate, Enum } from '@mikro-orm/core';
import { BaseEntity } from '@guardian/common';

/**
 * Document for approve
 */
@Entity()
export class ApprovalDocument extends BaseEntity implements IApprovalDocument {
    /**
     * Document owner
     */
    @Property({
        nullable: true,
        index: true
    })
    owner?: string;

    /**
     * Document approver
     */
    @Property({ nullable: true })
    approver?: string;

    /**
     * Document instance
     */
    @Property({ nullable: true })
    document?: IVC;

    /**
     * Document policy id
     */
    @Property({
        nullable: true,
        index: true
    })
    policyId?: string;

    /**
     * Document type
     */
    @Enum({ nullable: true })
    type?: SchemaEntity;

    /**
     * Created at
     */
    @Property({
        index: true
    })
    createDate: Date = new Date();

    /**
     * Updated at
     */
    @Property({ onUpdate: () => new Date() })
    updateDate: Date = new Date();

    /**
     * Document tag
     */
    @Property({ nullable: true })
    tag?: string;

    /**
     * Document option
     */
    @Property({ nullable: true })
    option?: any;

    /**
     * Document schema
     */
    @Property({ nullable: true })
    schema?: string;

    /**
     * User group
     */
    @Property({ nullable: true })
    group?: any;

    /**
     * Default document values
     */
    @BeforeCreate()
    setDefaults() {
        this.option = this.option || {};
        this.option.status = this.option.status || ApproveStatus.NEW;
    }
}
