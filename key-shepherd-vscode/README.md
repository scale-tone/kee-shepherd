# KeyShepherd

Keeps an eye on credentials (secrets, access keys, connection strings etc.), that are spread across numerous config files on your devbox(es). Gives you centralized access to them. Also hides (masks) them whenever possible.

<img src="https://user-images.githubusercontent.com/5447190/142744174-e8fbc6f6-bf76-4a43-b53b-be49c22d3655.png" width="800">

## Features

To put a secret under KeyShepherd's control, you can either *insert* it via KeyShepherd:

<img src="https://user-images.githubusercontent.com/5447190/142769450-6cee8be0-9d19-4102-98cf-07264c215d16.png" width="600">

or select an existing secret in the text editor and *add* it to KeyShepherd:

<img src="https://user-images.githubusercontent.com/5447190/142769515-e42c15ad-eceb-4dea-b74b-3e4647850110.png" width="600">

Since now KeyShepherd will remember its exact position and proceed with keeping track of it.

Two types of secrets are supported:
* **Supervised**. This is a lightweight form of it, just to remember where you left this secret value and to let you navigate back to it at any moment. Your actual config files are left intact.
* **Managed** aka stashable. These secrets you can **stash/unstash**:

  <img src="https://user-images.githubusercontent.com/5447190/142770184-800a0e90-e26a-4b4d-98b6-4dad886bb247.png" width="600">

  When a secret is **stashed**, KeyShepherd replaces its value with an anhcor like `@KeyShepherd(<secret-name>)`. **Unstashing** does the opposite.
  
  **Stashing/unstashing does modifies your files**, since this is the whole point of it.
  KeyShepherd can automatically stash all secrets in a workspace when it is closed and automatically unstash them when a workspace is opened. Default mode is to automatically stash, but do not automatically unstash. You can configure this via Settings (see below).

It's perfectly fine to mix both **supervised** and **managed** secrets in the same config file. A good strategy could be to mark real secrets (access keys, connection strings etc.) as **managed** (to keep them safe) and leave less important values like user names, application ids etc. as **supervised** (to make it easy to find them later).

KeyShepherd always tries its best to **mask** (hide) your secret values whenever possible, so that they never get accidentally exposed during a demo or a video call.
You can always **mask/unmask** them yourself:

  <img src="https://user-images.githubusercontent.com/5447190/142770778-b457c2d5-686c-4ae4-a7f4-4cab9727c3f6.png" width="500">

A good idea would be to set some keyboard shortcuts of your choice to these **mask/unmask** commands.


At first run KeyShepherd will ask you where to store secret's metadata:

  <img src="https://user-images.githubusercontent.com/5447190/142771123-f32e5040-278a-4456-b13c-2913e1679497.png" width="500">

Two options are currently supported:
* **Locally**, as JSON files in VsCode's global storage folder (`C:\Users\user-name\AppData\Roaming\Code\User\globalStorage\key-shepherd.key-shepherd-vscode` on Windows). 
* **In a shared Azure Table**. Works slower and requires internet connectivity, but lets you oversee your (and your teammate's) secrets on other machines. Especially useful with [GitHub Codespaces](https://github.com/features/codespaces) (yes, KeyShepherd works in GitHub Codespaces as well). 

You can always change the storage type later on with `Switch to Another Storage Type` command:

  <img src="https://user-images.githubusercontent.com/5447190/142771583-53e80244-4a6d-4204-8328-49730ac927fb.png" width="400">

**IMPORTANT: KeyShepherd does not store your actual secret values, only cryptographically strong salted SHA256 hashes of them (plus their lengths and positions in files).** Yet still, even this information might be somewhat useful for a potential attacker, so please make sure that secret metadata never gets leaked.

## Requirements

For most features to work you need to have [Azure Account](https://marketplace.visualstudio.com/items?itemName=ms-vscode.azure-account) extension installed and be signed in into Azure.

## Extension Settings

You can configure whether KeyShepherd should **automatically stash/unstash** secrets in a workspace, when you open/close it:

  <img src="https://user-images.githubusercontent.com/5447190/142771961-2d0dc15c-3713-40d8-8d55-417c2cc9b3aa.png" width="500">

**Automatic stashing/unstashing** is the most secure option: your actual secret values will only be present in your config files while you're actually working with a project (aka while a VsCode instance is running).

## Known Issues

* Only UTF8-encoded files are supported. If your config file was saved with a different encoding and you have some **managed** secrets in it, chances are that the file will be broken during **stashing/unstashing**.
* **Masking** does not (yet) work instantly, when you open a file. Secret values might be visible for a fraction of a second. Important to remember this when making a recorded video session. A safer option would be to keep them **stashed** and **unstash** on demand.
