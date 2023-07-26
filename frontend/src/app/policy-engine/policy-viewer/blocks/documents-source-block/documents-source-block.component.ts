import { Component, Input, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { PolicyEngineService } from 'src/app/services/policy-engine.service';
import { PolicyHelper } from 'src/app/services/policy-helper.service';
import { DialogBlock } from '../../dialog-block/dialog-block.component';
import { forkJoin } from 'rxjs';
import { VCViewerDialog } from 'src/app/schema-engine/vc-dialog/vc-dialog.component';
import { animate, state, style, transition, trigger } from '@angular/animations';
import { WebSocketService } from 'src/app/services/web-socket.service';

/**
 * Component for display block of 'interfaceDocumentsSource' types.
 */
@Component({
    selector: 'documents-source-block',
    templateUrl: './documents-source-block.component.html',
    styleUrls: ['./documents-source-block.component.css'],
    animations: [
        trigger('statusExpand', [
            state('collapsed', style({ height: '0px', minHeight: '0' })),
            state('expanded', style({ height: '*' })),
            transition('expanded <=> collapsed', animate('225ms cubic-bezier(0.4, 0.0, 0.2, 1)')),
        ]),
    ]
})
export class DocumentsSourceBlockComponent implements OnInit {
    @Input('id') id!: string;
    @Input('policyId') policyId!: string;
    @Input('static') static!: any;

    isActive = false;
    loading: boolean = true;
    socket: any;
    params: any;

    fields: any[];
    columns: any[];
    documents: any[] | null;
    children: any[] | null;
    insert: any;
    addons: any;
    fieldMap!: { [x: string]: any[] };
    commonAddons: any[];
    paginationAddon: any;
    statusDetailed: any;
    sortOptions: any = {
        active: '',
        direction: ''
    };
    enableSorting: boolean = false;

    constructor(
        private policyEngineService: PolicyEngineService,
        private wsService: WebSocketService,
        private policyHelper: PolicyHelper,
        private dialog: MatDialog
    ) {
        this.fields = [];
        this.columns = [];
        this.documents = null;
        this.children = null;
        this.commonAddons = [];
        this.paginationAddon = null;
    }

    ngOnInit(): void {
        if (!this.static) {
            this.socket = this.wsService.blockSubscribe(this.onUpdate.bind(this));
        }
        this.loadData();
    }

    ngOnDestroy(): void {
        if (this.socket) {
            this.socket.unsubscribe();
        }
    }

    onUpdate(id: string): void {
        if (this.id == id) {
            this.loadData();
        }
    }

    loadData() {
        this.loading = true;
        if (this.static) {
            this.setData(this.static);
            setTimeout(() => {
                this.loading = false;
            }, 500);
        } else {
            forkJoin([
                this.policyEngineService.getBlockData(this.id, this.policyId)
            ]).subscribe((value) => {
                const data: any = value[0];
                this.setData(data).then(() => {
                    setTimeout(() => {
                        this.loading = false;
                    }, 500);
                });
            }, (e) => {
                console.error(e.error);
                this.loading = false;
            });
        }
    }

    async setData(data: any) {
        if (data) {
            const fields: any[] = data.fields || [];
            this.fieldMap = {};
            this.fields = [];
            for (let i = 0; i < fields.length; i++) {
                const element = fields[i];
                element.names = element.name.split('.');
                element.index = String(i);
                if (element.bindBlock) {
                    element._block = await this.getBindBlock(element);
                }
                if (this.fieldMap[element.title]) {
                    this.fieldMap[element.title].push(element);
                } else {
                    this.fieldMap[element.title] = [element];
                    this.fields.push(element);
                }
            }
            this.children = data.children;
            this.columns = this.fields.map(f => f.index);
            this.columns.unshift('history');
            this.documents = data.data || [];
            this.sortHistory(this.documents);
            this.isActive = true;
            const sortingField = this.fields.find(item => item.name === data.orderField);
            this.sortOptions.active = sortingField && sortingField.index || '';
            this.sortOptions.direction = data.orderDirection && data.orderDirection.toLowerCase() || '';
            this.enableSorting = data.enableSorting;
            this.insert = data.insert;
            this.addons = data.blocks || [];
            this.commonAddons = data.commonAddons;
            this.paginationAddon = this.commonAddons.find((addon) => {
                return addon.blockType === "paginationAddon"
            })
        } else {
            this.fieldMap = {};
            this.fields = [];
            this.columns = [];
            this.documents = null;
            this.children = null;
            this.isActive = false;
            this.addons = [];
            this.paginationAddon = null;
        }
    }

    sortHistory(documents: any) {
        if (!documents) {
            return;
        }
        for (const doc of documents) {
            if (doc.history) {
                doc.history.sort(function (a: any, b: any) {
                    const aDate = new Date(a.created as string);
                    const bDate = new Date(b.created as string);
                    return bDate.getTime() - aDate.getTime();
                });
            }
        }
    }

    async getBindBlock(element: any) {
        return new Promise<any>(async (resolve, reject) => {
            this.policyEngineService.getBlockDataByName(element.bindBlock, this.policyId).subscribe((data: any) => {
                resolve(data);
            }, (e) => {
                reject();
            });
        });
    }

    onDialog(row: any, field: any) {
        const data = row;
        const document = row[field.name];
        if (field._block) {
            const dialogRef = this.dialog.open(DialogBlock, {
                width: '850px',
                data: {
                    data: data,
                    document: document,
                    dialogType: field.dialogType,
                    dialogClass: field.dialogClass,
                    title: field.dialogContent,
                    block: field._block,
                    static: this.getConfig(row, field, field._block),
                    policyId: this.policyId
                }
            });
            dialogRef.afterClosed().subscribe(async (result) => { });
        } else {
            const dialogRef = this.dialog.open(VCViewerDialog, {
                width: '850px',
                data: {
                    document: document,
                    title: field.dialogContent,
                    type: 'VC',
                    viewDocument: true
                }
            });
            dialogRef.afterClosed().subscribe(async (result) => { });
        }
    }

    getText(row: any, field: any) {
        try {
            if (field.content) {
                return field.content;
            }
            if (field.names) {
                let d = row[field.names[0]];
                for (let i = 1; i < field.names.length; i++) {
                    const name = field.names[i];
                    if (name === 'L' && Array.isArray(d)) {
                        d = d[d.length - 1];
                    } else {
                        d = d[name];
                    }
                }
                return d;
            } else {
                return row[field.name];
            }
        } catch (error) {
            return "";
        }
    }

    getIssuer(row: any, field: any) {
        try {
            if (field.content) {
                return field.content;
            }
            if (field.names) {
                let d = row[field.names[0]];
                for (let i = 1; i < field.names.length; i++) {
                    const name = field.names[i];
                    if (name === 'L' && Array.isArray(d)) {
                        d = d[d.length - 1];
                    } else {
                        d = d[name];
                    }
                }
                if (typeof d === 'object') {
                    return d.id;
                }
                return d;
            } else {
                if (typeof row[field.name] === 'object') {
                    return row[field.name].id;
                }
                return row[field.name];
            }
        } catch (error) {
            return "";
        }
    }

    getGroup(row: any, field: any): any | null {
        const items = this.fieldMap[field.title];
        if (items) {
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (!item.bindGroup) {
                    return item;
                }
                if (row.__sourceTag__ == item.bindGroup) {
                    return item;
                }
            }
        }
        return null;
    }

    getObjectValue(data: any, value: any) {
        let result: any = null;
        if (data && value) {
            const keys = value.split('.');
            result = data;
            for (let i = 0; i < keys.length; i++) {
                const key = keys[i];
                if (key === 'L' && Array.isArray(result)) {
                    result = result[result.length - 1];
                } else {
                    result = result[key];
                }
            }
        }
        return result;
    }

    getConfig(row: any, field: any, block: any) {
        if (row.blocks && row.blocks[block.id]) {
            const config = row.blocks[block.id];
            config.data = row;
            return config;
        } else {
            const config = { ...block };
            config.data = row;
            return config;
        }
    }

    onButton(event: MouseEvent, row: any, field: any) {
        event.preventDefault();
        event.stopPropagation();
        if (field.action == 'dialog') {
            this.onDialog(row, field);
        }
        if (field.action == 'link') {
            this.onRedirect(row, field);
        }
    }

    onRedirect(row: any, field: any) {
        const data = row;
        const value = this.getObjectValue(row, field.name);
        this.loading = true;
        this.policyEngineService.getGetIdByName(field.bindBlock, this.policyId).subscribe(({ id }: any) => {
            this.policyEngineService.getParents(id, this.policyId).subscribe((parents: any[]) => {
                this.policyEngineService.setBlockData(id, this.policyId, { filterValue: value }).subscribe(() => {
                    this.loading = false;
                    const filters: any = {};
                    for (let index = parents.length - 1; index > 0; index--) {
                        filters[parents[index]] = parents[index - 1];
                    }
                    filters[parents[0]] = value;
                    this.policyHelper.setParams(filters);
                }, (e) => {
                    console.error(e.error);
                    this.loading = false;
                });
            }, (e) => {
                console.error(e.error);
                this.loading = false;
            });
        }, (e) => {
            console.error(e.error);
            this.loading = false;
        });
    }

    onSortChange(event: any) {
        const field = this.fields.find(item => item.index === event.active);
        if (!field || !field.name) {
            return;
        }
        this.policyEngineService.setBlockData(this.id, this.policyId, {
            orderField: field.name,
            orderDirection: event.direction
        }).subscribe();
    }
}
