import { NgModule } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { BrowserModule } from '@angular/platform-browser';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { HTTP_INTERCEPTORS, HttpClientModule } from '@angular/common/http';
import { CommonModule } from '@angular/common';
import { ToastrModule } from 'ngx-toastr';
import { AppRoutingModule, AuditorGuard, UserGuard, StandardRegistryGuard } from './app-routing.module';
import { AppComponent } from './app.component';
import { AuthInterceptor, AuthService } from "./services/auth.service";
import { ProfileService } from "./services/profile.service";
import { TokenService } from './services/token.service';
import { SchemaService } from './services/schema.service';
import { HandleErrorsService } from "./services/handle-errors.service";
import { AuditService } from './services/audit.service';
import { PolicyEngineService } from './services/policy-engine.service';
import { UserProfileComponent } from './views/user-profile/user-profile.component';
import { LoginComponent } from './views/login/login.component';
import { HomeComponent } from './views/home/home.component';
import { HeaderComponent } from './views/header/header.component';
import { RegisterComponent } from './views/register/register.component';
import { RootConfigComponent } from './views/root-config/root-config.component';
import { TokenConfigComponent } from './views/token-config/token-config.component';
import { TokenDialog } from './components/token-dialog/token-dialog.component';
import { AuditComponent } from './views/audit/audit.component';
import { TrustChainComponent } from './views/trust-chain/trust-chain.component';
import { NewPolicyDialog } from './policy-engine/helpers/new-policy-dialog/new-policy-dialog.component';
import { DemoService } from './services/demo.service';
import { PolicyHelper } from './services/policy-helper.service';
import { MaterialModule } from './material.module';
import { PolicyEngineModule } from './policy-engine/policy-engine.module';
import { IPFSService } from './services/ipfs.service';
import { SettingsService } from './services/settings.service';
import { LoggerService } from './services/logger.service';
import { AdminHeaderComponent } from './views/admin/admin-header/admin-panel.component';
import { LogsViewComponent } from './views/admin/logs-view/logs-view.component';
import { SettingsViewComponent } from './views/admin/settings-view/settings-view.component';
import { IconPreviewDialog } from './components/icon-preview-dialog/icon-preview-dialog.component';
import { DetailsLogDialog } from './views/admin/details-log-dialog/details-log-dialog.component';
import { ServiceStatusComponent } from './views/admin/service-status/service-status.component';
import { CommonComponentsModule } from './common-components.module';
import { ConfirmationDialogComponent } from './components/confirmation-dialog/confirmation-dialog.component';
import { InfoComponent } from './components/info/info/info.component';
import { WebSocketService } from './services/web-socket.service';
import { MessageTranslationService } from './services/message-translation-service/message-translation-service';
import { TasksService } from './services/tasks.service';
import { ArtifactService } from './services/artifact.service';
import { ContractConfigComponent } from './views/contract-config/contract-config.component';
import { ContractService } from './services/contract.service';
import { ContractRequestConfigComponent } from './views/contract-request-config/contract-request-config.component';
import { AddPairDialogComponent } from './components/add-pair-dialog/add-pair-dialog.component';
import { RetireTokenDialogComponent } from './components/retire-token-dialog/retire-token-dialog.component';
import { DataInputDialogComponent } from './components/data-input-dialog/data-input-dialog.component';
import { CompareModule } from './analytics/analytics.module';
import { AnalyticsService } from './services/analytics.service';

@NgModule({
    declarations: [
        AppComponent,
        UserProfileComponent,
        LoginComponent,
        HomeComponent,
        HeaderComponent,
        RegisterComponent,
        RootConfigComponent,
        TokenConfigComponent,
        TokenDialog,
        AuditComponent,
        TrustChainComponent,
        NewPolicyDialog,
        LogsViewComponent,
        SettingsViewComponent,
        AdminHeaderComponent,
        IconPreviewDialog,
        DetailsLogDialog,
        ServiceStatusComponent,
        ConfirmationDialogComponent,
        InfoComponent,
        ContractConfigComponent,
        ContractRequestConfigComponent,
        AddPairDialogComponent,
        RetireTokenDialogComponent,
        DataInputDialogComponent,
    ],
    imports: [
        BrowserModule,
        CommonModule,
        CommonComponentsModule,
        MaterialModule,
        AppRoutingModule,
        BrowserAnimationsModule,
        HttpClientModule,
        FormsModule,
        ToastrModule.forRoot(),
        PolicyEngineModule,
        CompareModule
    ],
    exports: [],
    providers: [
        WebSocketService,
        UserGuard,
        StandardRegistryGuard,
        AuditorGuard,
        AuthService,
        ProfileService,
        TokenService,
        SchemaService,
        AnalyticsService,
        AuditService,
        PolicyEngineService,
        PolicyHelper,
        IPFSService,
        ArtifactService,
        SettingsService,
        LoggerService,
        DemoService,
        MessageTranslationService,
        TasksService,
        ContractService,
        {
            provide: HTTP_INTERCEPTORS,
            useClass: HandleErrorsService,
            multi: true
        },
        {
            provide: HTTP_INTERCEPTORS,
            useClass: AuthInterceptor,
            multi: true
        }
    ],
    bootstrap: [AppComponent]
})
export class AppModule {

}
