import { Component, Inject } from '@angular/core';
import { MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';

@Component({
    selector: 'compare-policy-dialog',
    templateUrl: './compare-policy-dialog.component.html',
    styleUrls: ['./compare-policy-dialog.component.css']
})
export class ComparePolicyDialog {
    loading = true;

    policy!: any;
    policies: any[];

    policyId1!: any;
    policyId2!: any;

    list1: any[];
    list2: any[];

    constructor(
        public dialogRef: MatDialogRef<ComparePolicyDialog>,
        @Inject(MAT_DIALOG_DATA) public data: any) {

        
        this.policy = data.policy;
        this.policies = data.policies || [];
        this.policyId1 = this.policy?.id;
        this.list1 = this.policies;
        this.list2 = this.policies;
    }

    ngOnInit() {
        this.loading = false;
    }

    setData(data: any) {
    }

    onClose(): void {
        this.dialogRef.close(false);
    }

    onCompare() {
        this.dialogRef.close({
            policyId1: this.policyId1,
            policyId2: this.policyId2,
        });
    }

    onChange() {
        this.list1 = this.policies.filter(s=>s.id !== this.policyId2);
        this.list2 = this.policies.filter(s=>s.id !== this.policyId1);
    }
}