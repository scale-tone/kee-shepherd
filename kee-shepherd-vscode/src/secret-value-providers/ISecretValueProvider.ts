import { SecretReference, SecretTypeEnum, ControlTypeEnum } from "../KeyMetadataHelpers";

export type SelectedSecretType = { type: SecretTypeEnum, name: string, value: string, properties: any, alreadyAskedForName?: boolean };

// Implements picking and retrieving secret values from various sources
export interface ISecretValueProvider {

    getSecretValue(secret: SecretReference): Promise<string>;
    pickUpSecret(controlType: ControlTypeEnum, suggestedResourceId?: string): Promise<SelectedSecretType | undefined>;
    isMyResourceId(resourceId: string): boolean;
}
