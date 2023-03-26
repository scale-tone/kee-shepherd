import * as vscode from 'vscode';

// Taken from https://docs.microsoft.com/en-us/azure/devops/integrate/get-started/authentication/oauth?view=azure-devops#scopes
export const azureDevOpsScopeOptions: vscode.QuickPickItem[] = [

    {
        label: 'Agent Pools',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.agentpools',
        label: 'Agent Pools (read)',
        detail: 'Grants the ability to view tasks, pools, queues, agents, and currently running or recently completed jobs for agents.'
    },
    {
        description: 'vso.agentpools_manage',
        label: 'Agent Pools (read, manage)',
        detail: 'Grants the ability to manage pools, queues, and agents.'
    },


    {
        label: 'Analytics',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.analytics',
        label: 'Analytics (read)',
        detail: 'Grants the ability to query analytics data.'
    },

    
    {
        label: 'Audit Log',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.auditlog',
        label: 'Audit Log (read)',
        detail: 'Grants the ability to read the auditing log to users.'
    },


    {
        label: 'Build',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.build',
        label: 'Build (read)',
        detail: 'Grants the ability to access build artifacts, including build results, definitions, and requests, and the ability to receive notifications about build events via service hooks.'
    },
    {
        description: 'vso.build_execute',
        label: 'Build (read and execute)',
        detail: 'Grants the ability to access build artifacts, including build results, definitions, and requests, and the ability to queue a build, update build properties, and the ability to receive notifications about build events via service hooks.'
    },


    {
        label: 'Code',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.code',
        label: 'Code (read)',
        detail: 'Grants the ability to read source code and metadata about commits, changesets, branches, and other version control artifacts. Also grants the ability to search code and get notified about version control events via service hooks.'
    },
    {
        description: 'vso.code_write',
        label: 'Code (read and write)',
        detail: 'Grants the ability to read, update, and delete source code, access metadata about commits, changesets, branches, and other version control artifacts. Also grants the ability to create and manage pull requests and code reviews and to receive notifications about version control events via service hooks.'
    },
    {
        description: 'vso.code_manage',
        label: 'Code (read, write, and manage)',
        detail: 'Grants the ability to read, update, and delete source code, access metadata about commits, changesets, branches, and other version control artifacts. Also grants the ability to create and manage code repositories, create and manage pull requests and code reviews, and to receive notifications about version control events via service hooks.'
    },
    {
        description: 'vso.code_full',
        label: 'Code (full)',
        detail: 'Grants full access to source code, metadata about commits, changesets, branches, and other version control artifacts. Also grants the ability to create and manage code repositories, create and manage pull requests and code reviews, and to receive notifications about version control events via service hooks. Also includes limited support for Client OM APIs.'
    },
    {
        description: 'vso.code_status',
        label: 'Code (status)',
        detail: 'Grants the ability to read and write commit and pull request status.'
    },

    {
        label: 'Connected Server',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.connected_server',
        label: 'Access endpoints',
        detail: ''
    },

    {
        label: 'Entitlements',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.entitlements',
        label: 'Entitlements (Read)',
        detail: ''
    },
    {
        description: 'vso.memberentitlementmanagement',
        label: 'MemberEntitlement Management (read)',
        detail: 'Grants the ability to read users, their licenses as well as projects and extensions they can access.'
    },
    {
        description: 'vso.memberentitlementmanagement_write',
        label: 'MemberEntitlement Management (write)',
        detail: 'Grants the ability to manage users, their licenses as well as projects and extensions they can access.'
    },


    {
        label: 'Environment',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.environment_manage',
        label: 'Read and manage environment',
        detail: ''
    },


    {
        label: 'Extensions',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.extension',
        label: 'Extensions (read)',
        detail: 'Grants the ability to read installed extensions.'
    },
    {
        description: 'vso.extension_manage',
        label: 'Extensions (read and manage)',
        detail: 'Grants the ability to install, uninstall, and perform other administrative actions on installed extensions.'
    },
    {
        description: 'vso.extension.data',
        label: 'Extension data (read)',
        detail: 'Grants the ability to read data (settings and documents) stored by installed extensions.'
    },
    {
        description: 'vso.extension.data_write',
        label: 'Extension data (read and write)',
        detail: 'Grants the ability to read and write data (settings and documents) stored by installed extensions.'
    },


    {
        label: 'Graph & identity',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.graph',
        label: 'Graph (read)',
        detail: 'Grants the ability to read user, group, scope, and group membership information.'
    },
    {
        description: 'vso.graph_manage',
        label: 'Graph (manage)',
        detail: 'Grants the ability to read user, group, scope and group membership information, and to add users, groups, and manage group memberships.'
    },
    {
        description: 'vso.identity',
        label: 'Identity (read)',
        detail: 'Grants the ability to read identities and groups.'
    },
    {
        description: 'vso.identity_manage',
        label: 'Identity (manage)',
        detail: 'Grants the ability to read, write, and manage identities and groups.'
    },


    {
        label: 'Load Test',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.loadtest',
        label: 'Load test (read)',
        detail: 'Grants the ability to read your load test runs, test results, and APM artifacts.'
    },
    {
        description: 'vso.loadtest_write',
        label: 'Load test (read and write)',
        detail: 'Grants the ability to create and update load test runs, and read metadata including test results and APM artifacts.'
    },


    {
        label: 'Machine Group',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.machinegroup_manage',
        label: 'Deployment group (read, manage)',
        detail: 'Provides ability to manage deployment group and agent pools.'
    },


    {
        label: 'Marketplace',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.gallery',
        label: 'Marketplace',
        detail: 'Grants read access to public and private items and publishers.'
    },
    {
        description: 'vso.gallery_acquire',
        label: 'Marketplace (acquire)',
        detail: 'Grants read access and the ability to acquire items.'
    },
    {
        description: 'vso.gallery_publish',
        label: 'Marketplace (publish)',
        detail: 'Grants read access and the ability to upload, update, and share items.'
    },
    {
        description: 'vso.gallery_manage',
        label: 'Marketplace (manage)',
        detail: 'Grants read access and the ability to publish and manage items and publishers.'
    },


    {
        label: 'Notifications',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.notification',
        label: 'Notifications (read)',
        detail: 'Provides read access to subscriptions and event metadata, including filterable field values.'
    },
    {
        description: 'vso.notification_write',
        label: 'Notifications (write)',
        detail: 'Provides read and write access to subscriptions and read access to event metadata, including filterable field values.'
    },
    {
        description: 'vso.notification_manage',
        label: 'Notifications (manage)',
        detail: 'Provides read, write, and management access to subscriptions and read access to event metadata, including filterable field values.'
    },
    {
        description: 'vso.notification_diagnostics',
        label: 'Notifications (diagnostics)',
        detail: 'Provides access to notification-related diagnostic logs and provides the ability to enable diagnostics for individual subscriptions.'
    },


    {
        label: 'Packaging',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.packaging',
        label: 'Packaging (read)',
        detail: 'Grants the ability to read feeds and packages.'
    },
    {
        description: 'vso.packaging_write',
        label: 'Packaging (read and write)',
        detail: 'Grants the ability to create and read feeds and packages.'
    },
    {
        description: 'vso.packaging_manage',
        label: 'Packaging (read, write, and manage)',
        detail: 'Grants the ability to create, read, update, and delete feeds and packages.'
    },


    
    {
        label: 'Pipeline Resources',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.pipelineresources_use',
        label: 'Use',
        detail: ''
    },
    {
        description: 'vso.pipelineresources_manage',
        label: 'Use and manage',
        detail: ''
    },
    


    {
        label: 'Project and Team',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.project',
        label: 'Project and team (read)',
        detail: 'Grants the ability to read projects and teams.'
    },
    {
        description: 'vso.project_write',
        label: 'Project and team (read and write)',
        detail: 'Grants the ability to read and update projects and teams.'
    },
    {
        description: 'vso.project_manage',
        label: 'Project and team (read, write and manage)',
        detail: 'Grants the ability to create, read, update, and delete projects and teams.'
    },


    
    {
        label: 'Pull Request Threads',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.threads_full',
        label: 'Read & write',
        detail: 'Grants the ability to read & write to pull request comment threads'
    },



    {
        label: 'Release',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.release',
        label: 'Release (read)',
        detail: 'Grants the ability to read release artifacts, including releases, release definitions and release environment.'
    },
    {
        description: 'vso.release_execute',
        label: 'Release (read, write and execute)',
        detail: 'Grants the ability to read and update release artifacts, including releases, release definitions and release environment, and the ability to queue a new release.'
    },
    {
        description: 'vso.release_manage',
        label: 'Release (read, write, execute and manage)',
        detail: 'Grants the ability to read, update, and delete release artifacts, including releases, release definitions and release environment, and the ability to queue and approve a new release.'
    },


    
    {
        label: 'Secure Files',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.securefiles_read',
        label: 'Read',
        detail: 'Grants the ability to read secure files'
    },
    {
        description: 'vso.securefiles_write',
        label: 'Read & Create',
        detail: 'Grants the ability to read & create secure files'
    },
    {
        description: 'vso.securefiles_manage',
        label: 'Read, create & manage',
        detail: 'Grants the ability to read, create, & manage secure files'
    },


    {
        label: 'Security',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.security_manage',
        label: 'Security (manage)',
        detail: 'Grants the ability to read, write, and manage security permissions.'
    },


    {
        label: 'Service Connections',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.serviceendpoint',
        label: 'Service Endpoints (read)',
        detail: 'Grants the ability to read service endpoints.'
    },
    {
        description: 'vso.serviceendpoint_query',
        label: 'Service Endpoints (read and query)',
        detail: 'Grants the ability to read and query service endpoints.'
    },
    {
        description: 'vso.serviceendpoint_manage',
        label: 'Service Endpoints (read, query and manage)',
        detail: 'Grants the ability to read, query, and manage service endpoints.'
    },


    {
        label: 'Settings',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.settings',
        label: 'Settings (read)',
        detail: 'Grants the ability to create and read settings.'
    },
    {
        description: 'vso.settings_write',
        label: 'Settings (read and write)',
        detail: ''
    },


    {
        label: 'Symbols',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.symbols',
        label: 'Symbols (read)',
        detail: 'Grants the ability to read symbols.'
    },
    {
        description: 'vso.symbols_write',
        label: 'Symbols (read and write)',
        detail: 'Grants the ability to read and write symbols.'
    },
    {
        description: 'vso.symbols_manage',
        label: 'Symbols (read, write and manage)',
        detail: 'Grants the ability to read, write, and manage symbols.'
    },


    {
        label: 'Task Groups',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.taskgroups_read',
        label: 'Task Groups (read)',
        detail: 'Grants the ability to read task groups.'
    },
    {
        description: 'vso.taskgroups_write',
        label: 'Task Groups (read, create)',
        detail: 'Grants the ability to read and create task groups.'
    },
    {
        description: 'vso.taskgroups_manage',
        label: 'Task Groups (read, create and manage)',
        detail: 'Grants the ability to read, create and manage taskgroups.'
    },


    {
        label: 'Team Dashboard',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.dashboards',
        label: 'Team dashboards (read)',
        detail: 'Grants the ability to read team dashboard information.'
    },
    {
        description: 'vso.dashboards_manage',
        label: 'Team dashboards (manage)',
        detail: 'Grants the ability to manage team dashboard information.'
    },


    {
        label: 'Test Management',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.test',
        label: 'Test management (read)',
        detail: 'Grants the ability to read test plans, cases, results and other test management related artifacts.'
    },
    {
        description: 'vso.test_write',
        label: 'Test management (read and write)',
        detail: 'Grants the ability to read, create, and update test plans, cases, results and other test management related artifacts.'
    },


    {
        label: 'Tokens',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.tokens',
        label: 'Delegated Authorization Tokens',
        detail: 'Grants the ability to manage delegated authorization tokens to users.'
    },
    {
        description: 'vso.tokenadministration',
        label: 'Token Administration',
        detail: 'Grants the ability to manage (view and revoke) existing tokens to organization administrators.'
    },


    {
        label: 'User Profile',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.profile',
        label: 'User profile (read)',
        detail: 'Grants the ability to read your profile, accounts, collections, projects, teams, and other top-level organizational artifacts.'
    },
    {
        description: 'vso.profile_write',
        label: 'User profile (write)',
        detail: 'Grants the ability to write to your profile.'
    },


    {
        label: 'Variable Groups',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.variablegroups_read',
        label: 'Variable Groups (read)',
        detail: 'Grants the ability to read variable groups.'
    },
    {
        description: 'vso.variablegroups_write',
        label: 'Variable Groups (read, create)',
        detail: 'Grants the ability to read and create variable groups.'
    },
    {
        description: 'vso.variablegroups_manage',
        label: 'Variable Groups (read, create and manage)',
        detail: 'Grants the ability to read, create and manage variable groups.'
    },


    {
        label: 'Wiki',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.wiki',
        label: 'Wiki (read)',
        detail: 'Grants the ability to read wikis, wiki pages and wiki attachments. Also grants the ability to search wiki pages.'
    },
    {
        description: 'vso.wiki_write',
        label: 'Wiki (read and write)',
        detail: 'Grants the ability to read, create and updates wikis, wiki pages and wiki attachments.'
    },


    {
        label: 'Work Items',
        kind: vscode.QuickPickItemKind.Separator
    },
    {
        description: 'vso.work',
        label: 'Work items (read)',
        detail: 'Grants the ability to read work items, queries, boards, area and iterations paths, and other work item tracking related metadata. Also grants the ability to execute queries, search work items and to receive notifications about work item events via service hooks.'
    },
    {
        description: 'vso.work_write',
        label: 'Work items (read and write)',
        detail: 'Grants the ability to read, create, and update work items and queries, update board metadata, read area and iterations paths other work item tracking related metadata, execute queries, and to receive notifications about work item events via service hooks.'
    },
    {
        description: 'vso.work_full',
        label: 'Work items (full)',
        detail: 'Grants full access to work items, queries, backlogs, plans, and work item tracking metadata. Also provides the ability to receive notifications about work item events via service hooks.'
    },
];
