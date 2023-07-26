import { NgModule } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MaterialModule } from 'src/app/material.module';
import { FormsModule } from '@angular/forms';
import { AppRoutingModule } from '../app-routing.module';
import { NgxFileDropModule } from 'ngx-file-drop';
import { CompareComponent } from './compare/compare.component';
import { ComparePolicyComponent } from './compare-policy/compare-policy.component';
import { CompareSchemaComponent } from './compare-schema/compare-schema.component';

@NgModule({
    declarations: [
        CompareComponent,
        CompareSchemaComponent,
        ComparePolicyComponent
    ],
    imports: [
        CommonModule,
        FormsModule,
        MaterialModule,
        AppRoutingModule,
        NgxFileDropModule
    ],
    exports: [
        CompareComponent,
        CompareSchemaComponent,
        ComparePolicyComponent
    ]
})
export class CompareModule { }
