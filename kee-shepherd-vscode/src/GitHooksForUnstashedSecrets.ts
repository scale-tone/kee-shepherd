import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

// Maintains git hooks to prevent unstashed secrets of being committed
export async function updateGitHooksForFile(fileUri: vscode.Uri, isUnstashed: boolean, secretsExistInThisFile: boolean): Promise<void> {

    // If secrets were unstashed, but there're actually no secrets in this file, then doing nothing
    if (!!isUnstashed && !secretsExistInThisFile) {
        return;
    }

    // If this is not a local file, then doing nothing
    if (fileUri.scheme !== 'file') {
        return;
    }

    const filePath = fileUri.fsPath;

    if (!filePath) {
        return;
    }

    var relativePath = [];

    // Searching for all .git folders up to the path root
    var currentFolder = path.dirname(filePath);
    while (true) {

        const gitFolder = path.join(currentFolder, '.git');
        if (!!fs.existsSync(gitFolder)) {
           
            await updateGitHooksForFileInGitFolder(gitFolder, [...relativePath, path.basename(filePath)], isUnstashed);
        }

        const parentFolder = path.dirname(currentFolder);
        if (parentFolder.length <= 0 || parentFolder === '.' || parentFolder === currentFolder) {
            break;
        }

        relativePath.unshift(path.basename(currentFolder));
        currentFolder = parentFolder;            
    }
}

async function updateGitHooksForFileInGitFolder(gitFolder: string, fileRelativePath: string[], isUnstashed: boolean): Promise<void> {

    const scriptFileName = path.join(gitFolder, 'hooks', 'keeshepherd-check-unstashed-secrets.sh');
    var scriptText = !fs.existsSync(scriptFileName) ? '' : await fs.promises.readFile(scriptFileName, 'utf8');

    // Reading existing file names from the script file
    var filesWithSecrets: string[] = [];
    const match = /filesWithSecrets=\( "(.+)" \)\n/i.exec(scriptText);
    if (!!match && match.length > 0) {

        const filesWithSecretsString = match[1];
        filesWithSecrets = filesWithSecretsString.split(`" "`);
    }

    const filePath = fileRelativePath.join('/');

    if (!!isUnstashed) {
        
        // adding this file to the list
        if (!filesWithSecrets.includes(filePath)) {
            filesWithSecrets.push(filePath);
        }

    } else {

        // removing this file from the list
        var i;
        while ((i = filesWithSecrets.indexOf(filePath)) >= 0) {
            filesWithSecrets.splice(i, 1);
        }
    }

    const hookFileName = path.join(gitFolder, 'hooks', 'pre-commit');
    var hookFileText = !fs.existsSync(hookFileName) ? '' : await fs.promises.readFile(hookFileName, 'utf8');

    const hookText = `
# KeeShepherd hook start
exec .git/hooks/keeshepherd-check-unstashed-secrets.sh
# KeeShepherd hook end`;
    
    const hookFileHeader = '#!/bin/sh';

    if (filesWithSecrets.length > 0) {

        // updating the validation script...
        scriptText = `
filesWithSecrets=( "${filesWithSecrets.join('" "')}" )

IFS=$'\\n' changedFiles=( $(git diff --name-only & git diff --cached --name-only & git ls-files --exclude-standard --others) )

detectedUnstashedSecrets=false

for changedFile in "\${changedFiles[@]}"
do
    for fileWithSecrets in "\${filesWithSecrets[@]}"
    do
        if [ "$fileWithSecrets" == "$changedFile" ]; then
            echo "KeeShepherd detected unstashed secrets in" $changedFile ". Stash or remove them before committing" >&2
            git reset HEAD -- "$changedFile"
            detectedUnstashedSecrets=true
        fi
    done
done

if [ "$detectedUnstashedSecrets" = true ] ; then
    exit 1
fi`;
        
        await fs.promises.writeFile(scriptFileName, scriptText);

        // ... and the hook file

        if (!hookFileText) {
            hookFileText += hookFileHeader;
        }

        if (!hookFileText.includes(hookText)) {
            hookFileText += hookText;
        }
        
    } else {

        // removing the validation script...
        await fs.promises.rm(scriptFileName, { force: true });

        // ... and updating the hook file
        hookFileText = hookFileText.replace(hookText, '');
    }

    // writing the hook file
    if (!hookFileText || hookFileText.trim() === hookFileHeader) {
        
        await fs.promises.rm(hookFileName, { force: true });

    } else {

        await fs.promises.writeFile(hookFileName, hookFileText);
    }
}