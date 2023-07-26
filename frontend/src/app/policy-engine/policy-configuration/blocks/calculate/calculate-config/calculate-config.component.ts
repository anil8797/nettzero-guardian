import { Component, EventEmitter, Input, OnInit, Output, SimpleChanges, ViewEncapsulation } from '@angular/core';
import { Schema, SchemaField, Token } from '@guardian/interfaces';
import { PolicyBlockModel, PolicyModel } from 'src/app/policy-engine/structures/policy-model';

/**
 * Settings for block of 'policyRolesBlock' type.
 */
@Component({
    selector: 'calculate-config',
    templateUrl: './calculate-config.component.html',
    styleUrls: ['./calculate-config.component.css'],
    encapsulation: ViewEncapsulation.Emulated
})
export class CalculateConfigComponent implements OnInit {
    @Input('policy') policy!: PolicyModel;
    @Input('block') currentBlock!: PolicyBlockModel;
    @Input('schemas') schemas!: Schema[];
    @Input('tokens') tokens!: Token[];
    @Input('readonly') readonly!: boolean;


    @Output() onInit = new EventEmitter();

    propHidden: any = {
        inputSchemaGroup: false,
        outputSchemaGroup: false
    };

    block!: any;

    constructor() {
    }

    ngOnInit(): void {
        this.onInit.emit(this);
        this.load(this.currentBlock);
    }

    ngOnChanges(changes: SimpleChanges) {
        this.load(this.currentBlock);
    }

    load(block: PolicyBlockModel) {
        this.block = block.properties;
        this.block.inputFields = this.block.inputFields || [];
        this.block.outputFields = this.block.outputFields || [];
        if (!this.block.inputSchema) {
            this.block.inputFields = [];
        }
        if (!this.block.outputSchema) {
            this.block.outputFields = [];
        }
    }

    onHide(item: any, prop: any) {
        item[prop] = !item[prop];
    }

    onSelectInput() {
        this.block.inputFields = [];
        const schema = this.schemas.find(e => e.iri == this.block.inputSchema)
        if (schema) {
            for (let i = 0; i < schema.fields.length; i++) {
                const field = schema.fields[i];
                this.block.inputFields.push({
                    name: field.name,
                    title: field.description,
                    value: field.name
                })
            }
        }
    }

    onSelectOutput() {
        this.block.outputFields = [];
        const schema = this.schemas.find(e => e.iri == this.block.outputSchema)
        if (schema) {
            for (let i = 0; i < schema.fields.length; i++) {
                const field = schema.fields[i];
                this.block.outputFields.push({
                    name: field.name,
                    title: field.description,
                    value: ''
                })
            }
        }
    }
}
