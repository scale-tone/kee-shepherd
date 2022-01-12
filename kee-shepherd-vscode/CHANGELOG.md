# Change Log

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
