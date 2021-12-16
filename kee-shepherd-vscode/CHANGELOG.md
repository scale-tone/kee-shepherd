# Change Log

## Version 1.1.0

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
