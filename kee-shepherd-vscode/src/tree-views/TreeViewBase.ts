import * as path from 'path';
import * as vscode from 'vscode';

const sodium = require('libsodium-wrappers');

import { Log } from '../helpers';
import { MinSecretLength } from '../KeyMetadataHelpers';

// Base class for all tree views
export class TreeViewBase {

    constructor(
        protected readonly _resourcesFolder: string,
        protected readonly _log: Log
    ) { }

    createTreeView(viewId: string): vscode.TreeView<vscode.TreeItem> {

        this._viewId = viewId;
        this._treeView = vscode.window.createTreeView(viewId, { treeDataProvider: this as any });

        return this._treeView;
    }

    public get viewId(): string {
        return this._viewId!;
    }

    protected _viewId?: string;
    protected _treeView?: vscode.TreeView<vscode.TreeItem>;

    protected askUserForSecretValue(preGenerateSecretValue?: boolean): Promise<string | undefined> {

        var inputBox = vscode.window.createInputBox();
    
        inputBox.title = 'Enter secret value. To generate random string use these buttons: ';
        inputBox.password = true;
    
        const specialSymbolsBtn = new SymbolsOnOffButton(
            this._resourcesFolder,
            'generate-secret-special-symbols',
            'special symbols',
            `~!@#$%^&*+-/.,\{}[]();:?<>=_`
        );
        const numbersBtn = new SymbolsOnOffButton(
            this._resourcesFolder,
            'generate-secret-numbers',
            'numbers',
            '0123456789'
        );
        const lowerLettersBtn = new SymbolsOnOffButton(
            this._resourcesFolder,
            'generate-secret-letters-lower',
            'lower letters',
            'abcdefghijklmnopqrstuvwxyz'
        );
        const upperLettersBtn = new SymbolsOnOffButton(
            this._resourcesFolder,
            'generate-secret-letters-upper',
            'upper letters',
            'ABCDEFGHIJKLMNOPQRSTUVWXYZ'
        );
    
        const showHideBtn = new ShowHideButton();
        const moreSymbolsBtn = new MoreSymbolsButton();
        const lessSymbolsBtn = new LessSymbolsButton();
        const generateBtn = new GenerateButton();
    
        const updateButtons = () => {
    
            inputBox.buttons = [
    
                generateBtn,
                moreSymbolsBtn,
                lessSymbolsBtn,
                upperLettersBtn,
                lowerLettersBtn,
                numbersBtn,
                specialSymbolsBtn,
                showHideBtn
            ];
        };
    
        updateButtons();
    
        let generatedValueLength = 16;
    
        const generateSecret = () => {
    
            const symbols = `${upperLettersBtn.symbols}${lowerLettersBtn.symbols}${numbersBtn.symbols}${specialSymbolsBtn.symbols}`;
    
            let secretValue = '';
            for (let i = 0; i < generatedValueLength; i++){
    
                secretValue += symbols[sodium.randombytes_uniform(symbols.length)];
            }
    
            inputBox.value = secretValue;
            inputBox.prompt = `${secretValue.length} symbols. `;
        };

        if (!!preGenerateSecretValue) {

            generateSecret();
        }
    
        return new Promise<string | undefined>((resolve, reject) => { 
    
            inputBox.onDidTriggerButton(btn => {
    
                const button = btn as unknown as ISecretValuePickerButton;
    
                button.isOn = !button.isOn;
    
                switch (button.type) {
    
                    case SecretValuePickerButtonType.showHide:
    
                        inputBox.password = button.isOn;
                        
                        break;
                    
                    case SecretValuePickerButtonType.symbolsOnOff:
    
                        // Making sure at least one symbol type is always selected
                        if (!(specialSymbolsBtn.isOn || numbersBtn.isOn || lowerLettersBtn.isOn || upperLettersBtn.isOn)) {
                            upperLettersBtn.isOn = true;
                        }
    
                        generateSecret();
    
                        break;
                    
                    case SecretValuePickerButtonType.moreSymbols:
    
                        generatedValueLength++;
                        
                        generateSecret();
                        
                        break;
                    
                    case SecretValuePickerButtonType.lessSymbols:
    
                        if (generatedValueLength > MinSecretLength) {
                            
                            generatedValueLength--;
                        }
                        
                        generateSecret();
                        
                        break;
                    
                    case SecretValuePickerButtonType.generate:
                        
                        generateSecret();
                        
                        break;
                }
    
                updateButtons();
            });
    
            inputBox.onDidChangeValue(val => {
    
                inputBox.prompt = `${inputBox.value.length} symbols. `;
            });
    
            inputBox.onDidAccept(() => {
    
                inputBox.hide();
                resolve(inputBox.value);
            });
            
            inputBox.onDidHide(() => { 
    
                inputBox.dispose();
                resolve(undefined);
            });
    
            inputBox.show();
        });
    }
}

enum SecretValuePickerButtonType {

    showHide = 0,
    symbolsOnOff,
    moreSymbols,
    lessSymbols,
    generate
}

interface ISecretValuePickerButton {

    get type(): SecretValuePickerButtonType;
    isOn: boolean;
}

class SymbolsOnOffButton implements ISecretValuePickerButton {

    constructor(private _resourcesFolder: string, private _iconPrefix: string, private _name: string, private _symbols: string) {
    }

    isOn: boolean = true;

    get type(): SecretValuePickerButtonType { return SecretValuePickerButtonType.symbolsOnOff; }

    get iconPath(): { light: vscode.Uri, dark: vscode.Uri } {

        const iconFileName = `${this._iconPrefix}-${this.isOn ? 'on' : 'off'}.svg`;

        return {
            light: vscode.Uri.file(path.join(this._resourcesFolder, 'light', iconFileName)),
            dark: vscode.Uri.file(path.join(this._resourcesFolder, 'dark', iconFileName))
        };
    }

    get tooltip(): string {

        return this.isOn ? `Disable ${this._name}` : `Enable ${this._name}`;
    }

    get symbols(): string {

        return this.isOn ? this._symbols : '';
    }
}

class ShowHideButton implements ISecretValuePickerButton {

    isOn: boolean = true;

    get type(): SecretValuePickerButtonType { return SecretValuePickerButtonType.showHide; }

    get iconPath(): vscode.ThemeIcon {

        return new vscode.ThemeIcon(this.isOn ? 'eye' : 'eye-closed');
    }

    get tooltip(): string {

        return this.isOn ? `Show` : `Hide`;
    }
}

class MoreSymbolsButton implements ISecretValuePickerButton {

    isOn: boolean = true;

    get type(): SecretValuePickerButtonType { return SecretValuePickerButtonType.moreSymbols; }

    get iconPath(): vscode.ThemeIcon {

        return new vscode.ThemeIcon('add');
    }

    get tooltip(): string {

        return 'More symbols';
    }
}

class LessSymbolsButton implements ISecretValuePickerButton {

    isOn: boolean = true;

    get type(): SecretValuePickerButtonType { return SecretValuePickerButtonType.lessSymbols; }

    get iconPath(): vscode.ThemeIcon {

        return new vscode.ThemeIcon('remove');
    }

    get tooltip(): string {

        return 'Less symbols';
    }
}

class GenerateButton implements ISecretValuePickerButton {

    isOn: boolean = true;

    get type(): SecretValuePickerButtonType { return SecretValuePickerButtonType.generate; }

    get iconPath(): vscode.ThemeIcon {

        return new vscode.ThemeIcon('refresh');
    }

    get tooltip(): string {

        return 'Generate';
    }
}
