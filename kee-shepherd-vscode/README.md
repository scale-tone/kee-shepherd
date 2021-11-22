# KeeShepherd

Keeps an eye on credentials (secrets, access keys, connection strings etc.), that are spread across numerous config files on your devbox(es). Gives you centralized access to them. Also hides (masks) them whenever possible.

<img src="https://user-images.githubusercontent.com/5447190/142853710-85ef42f6-2e30-46f2-a1ed-7f56fde13ccb.png" width="900">

## Features

### Insert/add, stash/unstash, mask/unmask

To put a secret under KeeShepherd's control, you can either **insert** it via KeeShepherd:

<img src="https://user-images.githubusercontent.com/5447190/142854298-f1cf92bd-561d-45ab-a11a-97be5047caf2.png" width="600">

or select an existing secret in the text editor and **add** it to KeeShepherd:

<img src="https://user-images.githubusercontent.com/5447190/142854551-a3be452e-95e8-407d-90c2-dbdebad33773.png" width="600">

**Insert** operation lets you pick up a secret from Azure Key Vault or directly from an Azure resource (by now Azure Storage and custom Azure Resource Manager URIs are supported, more secret sources like Service Bus, Event Hubs, Azure SQL etc. are on its way). **Add** operation will suggest to put the selected value into Azure Key Vault.

Once a secret is added or inserted, KeeShepherd will remember its exact position and proceed with keeping track of it.

Two types of secrets are supported:
* **Supervised**. This is a lightweight form of it, just to remember where you left this secret value and to let you navigate back to it at any moment. Your actual config files are left intact.
* **Managed** aka stashable. These secrets you can **stash/unstash**:

  <img src="https://user-images.githubusercontent.com/5447190/142855506-7aafa304-38ba-47cf-abc3-fc633bb8597c.png" width="400">

  When a secret is **stashed**, KeeShepherd replaces its value with an anchor like `@KeeShepherd(<secret-name>)`. **Unstashing** does the opposite (the secret value is taken from wherever it is actually stored, e.g. from Azure Key Vault).
  
  **Stashing/unstashing does modifies your files**, since this is the whole point of it.
  KeeShepherd can **automatically stash** all secrets in a workspace when it is closed and **automatically unstash** them when a workspace is opened. Default mode is to automatically stash, but do not automatically unstash. You can configure this via Settings (see below).

It's perfectly fine to mix both **supervised** and **managed** secrets in the same config file. A good strategy could be to mark real secrets (access keys, connection strings etc.) as **managed** (to keep them safe) and leave less important values like user names, application ids etc. as **supervised** (to make it easy to find them later).

KeeShepherd always tries its best to **mask** (hide) your secret values whenever possible, so that they never get accidentally exposed during a demo or a video call.
You can always **mask/unmask** them yourself:

  <img src="https://user-images.githubusercontent.com/5447190/142855972-a96f6a68-8ba9-4624-aa52-4a6038b4f034.png" width="500">

A good idea would be to set some keyboard shortcuts of your choice to these **mask/unmask** commands.

### Configure and use secret metadata storage

At first run KeeShepherd will ask you where to store secret's metadata:

  <img src="https://user-images.githubusercontent.com/5447190/142771123-f32e5040-278a-4456-b13c-2913e1679497.png" width="500">

Two options are currently supported:
* **Locally**, as JSON files in VsCode's global storage folder (`C:\Users\user-name\AppData\Roaming\Code\User\globalStorage\kee-shepherd.kee-shepherd-vscode` on Windows). 
* **In a shared Azure Table**. Works slower and requires internet connectivity, but lets you oversee your (and your teammate's) secrets on other machines. Especially useful with [GitHub Codespaces](https://github.com/features/codespaces) (yes, KeeShepherd works in GitHub Codespaces as well). 

You can always change the storage type later on with `Switch to Another Storage Type` command:

  <img src="https://user-images.githubusercontent.com/5447190/142856265-a4e4457d-e78d-4417-ae32-3a45742c06dd.png" width="400">

**IMPORTANT: KeeShepherd does not store your actual secret values, only links to them and cryptographically strong salted SHA256 hashes of them (plus secret lengths and positions in files).** Yet still, even this information might be somewhat useful for a potential attacker, so please make sure that secret metadata never gets leaked.

You can see, navigate to and manage all your secrets via `SECRETS` view that appears on the `EXPLORER` tab:

<img src="https://user-images.githubusercontent.com/5447190/142772847-a38158cc-01d0-4d44-9961-5199c2736d7d.png" width="400">

## Requirements

For most features to work you need to have [Azure Account](https://marketplace.visualstudio.com/items?itemName=ms-vscode.azure-account) extension installed and be signed in into Azure.

## Extension Settings

You can configure whether KeeShepherd should **automatically stash/unstash** secrets in a workspace, when you open/close it:

  <img src="https://user-images.githubusercontent.com/5447190/142856449-e97b240c-e487-4725-b7ba-d3a68a25d930.png" width="500">

**Automatic stashing/unstashing** is the most secure option: your actual secret values will only be present in your config files while you're actually working with a project (aka while a VsCode instance is running).



## Known Issues

* Only UTF8-encoded files are supported. If your config file was saved with a different encoding and you have some **managed** secrets in it, the file is likely to be broken during **stashing/unstashing**.
* **Masking** does not (yet) work instantly, when you open a file. Secret values might be visible for a fraction of a second. Important to remember this when making a recorded video session. A safer option would be to keep them **stashed** and **unstash** on demand.
* In some cases KeeShepherd need to tediously calculate SHA256 hashes at each position in a file. This can take time, if a file is long enough (> 30K symbols). So a good idea is to keep your config files small.