# KeeShepherd

Keeps an eye on credentials (secrets, access keys, connection strings etc.), that are spread across numerous config files on your devbox(es). Gives you centralized access to them. Hides (masks) them whenever possible.

Now also comes with a UI for Azure Key Vault and GitHub Codespaces/Actions secrets.

<img src="https://user-images.githubusercontent.com/5447190/210344942-d2a905c8-7732-434d-9f97-44ee59034e08.png" width="900">

## TL;DR

* Quickly get secrets from various supported sources ([see below](#supported-secret-sources)).
* Remember where you left them.
* Mask/unmask and stash/unstash them.
* Create shortcuts to them, for quick access.
* Mount them as Environment Variables.
* Manage your Azure Key Vault and GitHub Codespaces/Actions secrets from within VsCode.

## Features

### Insert/add, stash/unstash, mask/unmask, resolve

To put a secret under KeeShepherd's control, you can either **insert** it into your text file via KeeShepherd:

<img src="https://user-images.githubusercontent.com/5447190/142854298-f1cf92bd-561d-45ab-a11a-97be5047caf2.png" width="600">

or select an existing secret in the text editor and **add** it to KeeShepherd:

<img src="https://user-images.githubusercontent.com/5447190/142854551-a3be452e-95e8-407d-90c2-dbdebad33773.png" width="600">


**Insert** operation lets you pick up a secret from Azure Key Vault or directly from an Azure resource (Azure Storage, Azure Service Bus, Azure Cosmos DB etc.). 

**Add** operation will suggest to put the selected value into Azure Key Vault.

Once a secret is added or inserted, KeeShepherd will remember its exact position and proceed with keeping track of it.

Three types of secrets are supported:
* **Supervised**. This is a lightweight form of it, just to remember where you left this secret value and to let you navigate back to it at any moment. Your actual config files are left intact.
* **Managed** aka stashable. These secrets you can **stash/unstash**:

  <img src="https://user-images.githubusercontent.com/5447190/142855506-7aafa304-38ba-47cf-abc3-fc633bb8597c.png" width="400">

  When a secret is **stashed**, KeeShepherd replaces its value with an anchor like `@KeeShepherd(<secret-name>)`. **Unstashing** does the opposite (the secret value is taken from wherever it is actually stored, e.g. from Azure Key Vault).
  
  **Stashing/unstashing does modifies your files**, since this is the whole point of it.
  KeeShepherd can **automatically stash** all secrets in a workspace when it is closed and **automatically unstash** them when a workspace is opened. Default mode is to automatically stash, but do not automatically unstash. You can configure this via Settings (see below).
  
  When **unstashing**, KeeShepherd will install a [Git Hook](https://www.atlassian.com/git/tutorials/git-hooks), that prevents your secret values from being accidentally committed. When **stashing** back, these hooks will be removed. This allows you to commit your config files with **stashed** secrets in them and not be afraid of accidentally committing their unstashed values.
  
* **Secret Shortcuts**. These can be organized into folders, mounted into terminal windows and/or installed as global environment variables. See [more details on this below](https://github.com/scale-tone/kee-shepherd/blob/main/kee-shepherd-vscode/README.md#use-secret-shortcuts).

It's perfectly fine to mix both **supervised** and **managed** secrets in the same config file. A good strategy could be to mark real secrets (access keys, connection strings etc.) as **managed** (to keep them safe) and leave less important values like user names, application ids etc. as **supervised** (to make it easy to find them later).

KeeShepherd always tries its best to **mask** (hide) your secret values whenever possible, so that they never get accidentally exposed during a demo or a video call.
You can always **mask/unmask** them yourself:

  <img src="https://user-images.githubusercontent.com/5447190/142855972-a96f6a68-8ba9-4624-aa52-4a6038b4f034.png" width="500">

A good idea would be to set some keyboard shortcuts of your choice to these **mask/unmask** commands.

On a fresh new devbox you can also quickly restore all your secrets with `Resolve Managed Secrets` command:

  <img src="https://user-images.githubusercontent.com/5447190/146411438-d0215ae3-9b81-4313-b6de-125dc9181a94.png" width="400">

It will collect all `@KeeShepherd(secret-name)` anchors in a file and try to match those secrets by name. If a secret with that name exists in the metadata storage, then a copy of it will be created for the current file. Then you can do a normal **unstash** process to get the actual secret values.

### User interface and clients to various secret sources

KeeShepherd comes with its own view container, where its various views are organized by default:

  <img src="https://user-images.githubusercontent.com/5447190/210448623-db9a4811-be97-4f96-aff6-18943cc96b30.png" width="400">

Those views are:

* **MANAGED/SUPERVISED SECRETS** shows all your **supervised** and **managed** secrets and the files containing them. Provides an overview of all your local secret usages and allows to quickly navigate back to them.
* **AZURE KEY VAULT SECRETS/CERTIFICATES** is a client for Azure Key Vault. Shows all Key Vault instances accessible to you, allows to quickly get secret/certificate values and versions, and to create/remove (soft-delete) secrets. Certificates appear along with secrets, copying a certificate value gives you a BASE64-encoded string of it.
* **GITHUB SECRETS** is a client for GitHub Codespaces and Actions secrets. Shows existing secrets, allows to create/update/remove them. Codespaces secret **values** are only accessible on their respective Codespaces instances, Actions secret values are not accessible (you can only create/update them, but not read them).
* **VSCODE SECRET STORAGE** is a user interface for those secrets stored in [VsCode Secret Storage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) (which in turn is an API to local OS-specific secret vaults). Provides a secure way to store secret values **locally** on a devbox, allows to create/read/update/remove them.
* **SECRET SHORTCUTS** allows you to create/manage **links** (shortcuts) to your most frequently used secrets.  See [more details on this below](https://github.com/scale-tone/kee-shepherd/blob/main/kee-shepherd-vscode/README.md#use-secret-shortcuts).

### Use Secret Shortcuts

**Secret Shortcuts** give you quick access to your most frequently used secrets. They can be organized in folders, with one default folder pre-existing:

  <img src="https://user-images.githubusercontent.com/5447190/210454020-e3a67785-876a-40a7-9fee-e65314dfcab2.png" width="400">

Secret shortcuts can be mounted as **global environment variables**:

  <img src="https://user-images.githubusercontent.com/5447190/210454789-d66dc48b-2b36-40a9-8917-cd8e7686fc0b.png" width="300">

On Windows this option adds the secret and its value into `HKEY_CURRENT_USER\Environment` registry key. On other platforms a command for setting that variable value is added into `$HOME/.bashrc` script.


For a given **Secret Shortcut Folder** you can open a custom terminal window, with all those secret values mounted as environment variables:

  <img src="https://user-images.githubusercontent.com/5447190/210455585-1586e20b-99ea-4aba-9f6d-df9ac2f6db5f.png" width="300">


### Configure and use secret metadata storage

At first run KeeShepherd will ask you where to store secret's metadata:

  <img src="https://user-images.githubusercontent.com/5447190/142771123-f32e5040-278a-4456-b13c-2913e1679497.png" width="500">

Two options are currently supported:
* **Locally**, as JSON files in VsCode's global storage folder (`C:\Users\user-name\AppData\Roaming\Code\User\globalStorage\kee-shepherd.kee-shepherd-vscode` on Windows). 
* **In a shared Azure Table**. Works slower and requires internet connectivity, but lets you oversee your (and your teammate's) secrets on other machines. Especially useful with [GitHub Codespaces](https://github.com/features/codespaces) (yes, KeeShepherd works in GitHub Codespaces as well). 

You can always change the storage type later on with `Switch to Another Metadata Storage` command:

  <img src="https://user-images.githubusercontent.com/5447190/142856265-a4e4457d-e78d-4417-ae32-3a45742c06dd.png" width="400">

**IMPORTANT: KeeShepherd does not store your actual secret values, only links to them and cryptographically strong salted SHA256 hashes of them (plus secret lengths and positions in files).** Yet still, even this information might be somewhat useful for a potential attacker, so please make sure that secret metadata never gets leaked.




## Supported Secret Sources

* [Azure Key Vault](https://docs.microsoft.com/en-us/azure/key-vault/general/about-keys-secrets-certificates#object-types)
* [Azure Storage](https://docs.microsoft.com/en-us/rest/api/storagerp/storage-accounts/list-keys)
* [Azure Service Bus](https://docs.microsoft.com/en-us/rest/api/servicebus/stable/queues-authorization-rules/list-keys)
* [Azure Event Hubs](https://docs.microsoft.com/en-us/rest/api/eventhub/stable/authorization-rules-event-hubs/list-keys)
* [Azure Event Grid](https://docs.microsoft.com/en-us/rest/api/eventgrid/controlplane-version2022-06-15/topics/list-shared-access-keys)
* [Azure Cosmos DB](https://docs.microsoft.com/en-us/rest/api/cosmos-db-resource-provider/2021-10-15/database-accounts/list-keys)
* [Azure Redis Cache](https://docs.microsoft.com/en-us/rest/api/redis/redis/list-keys)
* [Azure Application Insights](https://docs.microsoft.com/en-us/rest/api/application-insights/components)
* [Azure Maps](https://docs.microsoft.com/en-us/rest/api/maps-management/accounts/list-keys)
* [Azure Cognitive Services](https://docs.microsoft.com/en-us/rest/api/cognitiveservices/accountmanagement/accounts/list-keys)
* [Azure Search](https://docs.microsoft.com/en-us/rest/api/searchmanagement/2020-08-01/admin-keys/get)
* [Azure SignalR Services](https://docs.microsoft.com/en-us/rest/api/signalr/signalr/list-keys)
* [Azure DevOps Personal Access Tokens](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate)
* [GitHub Codespaces secrets](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-encrypted-secrets-for-your-codespaces)
* [VsCode SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) aka locally on a devbox
* [Custom (Azure Resource Manager REST API)](https://docs.microsoft.com/en-us/rest/api/azure/)

## Requirements

For most features to work you need to have [Azure Account](https://marketplace.visualstudio.com/items?itemName=ms-vscode.azure-account) extension installed and be signed in into Azure.
For GitHub secrets you need to have [GitHub](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github) extension installed and be signed in into GitHub. On a GitHub Codespaces instance this happens automatically.

## Extension Settings

You can configure whether KeeShepherd should **automatically stash/unstash** secrets in a workspace, when you open/close it:

  <img src="https://user-images.githubusercontent.com/5447190/142856449-e97b240c-e487-4725-b7ba-d3a68a25d930.png" width="500">

**Automatic stashing/unstashing** is the most secure option: your actual secret values will only be present in your config files while you're actually working with a project (aka while a VsCode instance is running).



## Known Issues

* Only UTF8-encoded files are supported. If your config file was saved with a different encoding and you have some **managed** secrets in it, the file is likely to be broken during **stashing/unstashing**.
* **Masking** does not (yet) work instantly, when you open a file. Secret values might be visible for a fraction of a second. Important to remember this when making a recorded video session. A safer option would be to keep them **stashed** and **unstash** on demand.
* In some cases KeeShepherd need to tediously calculate SHA256 hashes at each position in a file. This can take time, if a file is long enough (> 30K symbols). So a good idea is to keep your config files small.
