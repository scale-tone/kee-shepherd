# Change Log

## Version 2.4

- Decoupled from (soon deprecated) [Azure Account extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode.azure-account).

## Version 2.3

- 'Generate Secret...' command, for quickly generating and storing secrets:

  <img src="https://github.com/scale-tone/kee-shepherd/assets/5447190/43cc9a84-9c32-413a-b33b-95fec44c6721" width="600px"/>

- Minor bugfixes.

## Version 2.2

- `Copy Secret to Clipboard...` command (with MRU list):

  <img src="https://github.com/scale-tone/kee-shepherd/assets/5447190/11d58243-e5b4-456f-aef3-294b64150e2d" width="600">



## Version 2.1

- Secret generator:

  <img src="https://user-images.githubusercontent.com/5447190/227786969-80713c64-c676-4727-baaf-3cfff32db1d5.png" width="600">

- Notifications about secrets that are about to expire (only Azure DevOps PATs currently supported):

  <img src="https://user-images.githubusercontent.com/5447190/227787169-c123ee71-311f-4fdf-be34-646f24620419.png" width="600">

- Code actions for operations like `Mask/Unmask` and `Stash/Unstash`:

  <img src="https://user-images.githubusercontent.com/5447190/227787430-e5f9cb55-64d8-4e9d-bfa9-6421ed8dcb60.png" width="300">

- Now when switching from one Metadata Storage to another secrets can be imported.
    
- Minor bugfixes.



## Version 2.0

- KeeShepherd now has its own view container, where its various views congregate by default:

  <img src="https://user-images.githubusercontent.com/5447190/210448623-db9a4811-be97-4f96-aff6-18943cc96b30.png" width="400">

- Env Variables have been converted into **Secret Shortcuts**:

  <img src="https://user-images.githubusercontent.com/5447190/210454020-e3a67785-876a-40a7-9fee-e65314dfcab2.png" width="400">

    which is now a convenient way to organize your most frequently used secrets. Note that (when storing secret metadata in an Azure Table) secret shortcuts are **not** machine-specific, so you get the same list on every devbox or Codespaces instance. Useful.
    
- Support for [GitHub Actions secrets](https://docs.github.com/en/actions/security-guides/encrypted-secrets): 

  <img src="https://user-images.githubusercontent.com/5447190/210458273-fe0884b7-0237-46fa-bdc9-1dc020427ede.png" width="400">

- [VsCode Secret Storage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage) as yet another way to securely store secret values:

  <img src="https://user-images.githubusercontent.com/5447190/210458413-e6e1a2d6-bc10-4aaa-b328-fce8090de96a.png" width="300">

- Migrated to [vscode.authentication API](https://code.visualstudio.com/api/references/vscode-api#authentication). This might result in you being asked to (re)login to Azure/GitHub.



## Version 1.6

- UI for [GitHub Codespaces Secrets](https://docs.github.com/en/codespaces/managing-your-codespaces/managing-encrypted-secrets-for-your-codespaces):

    <img src="https://user-images.githubusercontent.com/5447190/192107512-a94cb245-df3c-494d-8bd3-d0327202d174.png" width="400">

    All Codespaces secrets (Personal, Organization and Repository) are now visible, accessible and updatable in one place.
    
    NOTE: to be able to see this view you need to have either [GitHub Codespaces](https://marketplace.visualstudio.com/items?itemName=GitHub.codespaces) or [GitHub Pull Requests and Issues](https://marketplace.visualstudio.com/items?itemName=GitHub.vscode-pull-request-github) extension also installed. In a Codespaces instance those extensions are installed out-of-the-box. 
    
    Also Codespaces secrets are now available as yet another secret source.

- Now you can use code completion to quickly insert secrets into text files:

    <img src="https://user-images.githubusercontent.com/5447190/192107138-95fb39bc-debb-446b-b7a1-b3173416ef37.png" width="400">

    Just type `@KeeShepherd(` and follow the flow.

- Showing Azure Key Vault secret *versions*:

    <img src="https://user-images.githubusercontent.com/5447190/192106967-df4f406f-6bf6-4c4b-8542-074f83d50131.png" width="300">

- Now hashing salt can be stored separately from secret metadata. 
    
    For local metadata storages it is now automatically moved to [VsCode SecretStorage](https://code.visualstudio.com/api/references/vscode-api#SecretStorage). 
    
    For Azure Table storages you now have the option to store the salt in Azure Key Vault:
    
    <img src="https://user-images.githubusercontent.com/5447190/192106796-0ab23259-5351-4e12-86da-38653ecefa88.png" width="400">
    
- Minor bugfixes.


## Version 1.5

- Very useful new secret source - [Azure DevOps PATs (Personal Access Tokens)](https://docs.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate). You can now create new PATs: 

    <img src="https://user-images.githubusercontent.com/5447190/183301759-dfee9078-3663-47c0-a07e-073c24ad138e.png" width="400">
    <br>
    <img src="https://user-images.githubusercontent.com/5447190/183301845-4281a7c0-65dc-4f3c-897d-d17d519c5284.png" width="600">
    <br>
    <img src="https://user-images.githubusercontent.com/5447190/183301931-a53f0b2c-19c4-4057-b7b2-c1a3c7e76aca.png" width="400">

    and then immediately put them into your Key Vault:
    
    <img src="https://user-images.githubusercontent.com/5447190/183302056-0e4f65c8-65af-451b-9f9d-00ee492809ab.png" width="400">
    <br>
    <img src="https://user-images.githubusercontent.com/5447190/183302176-90c50f29-2344-4253-b686-7a5afe04d733.png" width="300">

    PAT scopes selection dialog is easily searchable. Or else you can manually type the list of required scopes as a space-separated string:
    
    <img src="https://user-images.githubusercontent.com/5447190/183302497-9d7a7e1f-f9d0-469d-aff7-29f84ab94568.png" width="500">

    NOTE: PAT's value is only retrievable at the moment of creation. So it is recommended to put it straight into Key Vault. That's what KeeShepherd does automatically when you create a PAT as a **managed** secret. When you create it as a **supervised** secret, the value is placed into your currently open text file, but *only into there*.

- `Create new Secret From...` command for Key Vault secrets:

    <img src="https://user-images.githubusercontent.com/5447190/183302871-b87ea4aa-b6a9-433d-847f-e97909b082da.png" width="300">

    Lets you quickly pick up a secret from any of the supported sources and put it straight into your Key Vault as a single operation (bypassing Clipboard or any other temporary buffers).
    
- [Azure SignalR Services](https://docs.microsoft.com/en-us/azure/azure-signalr/signalr-overview) as yet another secret source.
- Minor bugfixes.


## Version 1.4

- Implemented a UI for Azure Key Vault secrets:

    ![image](https://user-images.githubusercontent.com/5447190/169872192-67d368a6-1a7b-4afd-a5e8-086253008f79.png)

    Once signed in into Azure, a `KEY VAULT (VIA KEESHEPHERD)` view should appear on the `AZURE` tab. It shows all accessible secrets in all accessible Key Vaults in all visible subscription. 
    
    You can add and remove ("soft-delete") secrets, and for each secret you can get its value or insert it as **Managed** to the current text cursor position.
    
- Other UI improvements
- Minor bugfixes.

## Version 1.3

- `Create from Clipboard` feature for environment variables:

    <img src="https://user-images.githubusercontent.com/5447190/162624045-d8406e1a-bf21-409d-ba3e-bcae48b250ad.png" width="300">

  Takes whatever text is currently stored in Clipboard, creates an environment variable out of it and also puts it as a secret into Key Vault. Useful for quickly creating secrets with password generators.
  
- More secret sources:
    * Azure Maps
    * Azure Cognitive Services
    * Azure Search
    
- Other UI improvements
- Minor bugfixes.

## Version 1.2

- Now secrets can be registered as environment variables:
  
    <img src="https://user-images.githubusercontent.com/5447190/149216698-65302427-e20d-4d95-afd1-18ff7a7dfd14.png" width="400">

  This allows to instantly open a Terminal window with secret values directly mounted to it as environment variables. No more copy/pasting, no more shell initialization scripts.
  See [more details here](https://github.com/scale-tone/kee-shepherd/blob/main/kee-shepherd-vscode/README.md#use-secrets-as-environment-variables).

- Dedicated output channel with KeeShepherd's execution logs:

    <img src="https://user-images.githubusercontent.com/5447190/149222393-f3483823-69c0-403b-90d3-47c61807d331.png" width="600">

- `Copy Secret Value to Clipboard` feature:

    <img src="https://user-images.githubusercontent.com/5447190/149222681-667907d6-ba8e-4455-b732-5723a67ecffd.png" width="400">

- Other UI improvements
- Minor bugfixes.

## Version 1.1.1

- Many new secret sources:

  ![image](https://user-images.githubusercontent.com/5447190/146413221-0afa85a9-81f8-4f5e-ae10-e7109e3631fa.png)

- `Resolve Managed Secrets` feature:

  ![image](https://user-images.githubusercontent.com/5447190/146411438-d0215ae3-9b81-4313-b6de-125dc9181a94.png)
  
  Collects all `@KeeShepherd(secret-name)` anchors in a file and tries to match those secrets by **name**. If a secret with that name exists in the [metadata storage](https://github.com/scale-tone/kee-shepherd/blob/main/kee-shepherd-vscode/README.md#configure-and-use-secret-metadata-storage), then creates a copy of it for the current file. 
  
  Very useful when configuring a fresh new devbox (instead of manually re-creating your config file, you can just copy the whole file from another machine *or pull it from the repo* - and restore all your secrets with this single commmand).
  
- Git Hooks for unstashed secrets. Now when you unstash your secrets, KeeShepherd installs a [Git Hook](https://www.atlassian.com/git/tutorials/git-hooks), that prevents files containing them from being accidentally committed (a commit will be blocked and an error will be shown, if you try). When you stash secrets back, the hooks are removed. 
  
  So now you can commit your config files with **stashed** secrets in them - and not be afraid of accidentally committing their unstashed values.

  IMPORTANT: this only works for **managed** (stashable/unstashable) secrets. **Supervised** secrets are ignored by this feature, so you'll need to somehow protect them yourself.

- Minor bugfixes.

## Version 1.0.0

- Initial release
