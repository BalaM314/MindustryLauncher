import { type Application } from "@balam314/cli-app";
import { LaunchOptions, State } from "./types.js";
export declare function copyMods(state: State): Promise<void>;
export declare function openDirectory(directory: string): Promise<void>;
export declare const versionUrls: {
    foo: {
        url: (version: string) => string;
        getLatestVersion: [string, RegExp];
        prefix: string;
        numberValidator: RegExp;
    };
    "foo-v6": {
        url: (version: string) => string;
        getLatestVersion: [string, RegExp];
        prefix: string;
        numberValidator: RegExp;
    };
    be: {
        url: (version: string) => string;
        getLatestVersion: [string, RegExp];
        prefix: string;
        numberValidator: RegExp;
    };
    vanilla: {
        url: (version: string) => string;
        getLatestVersion: [string, RegExp];
        prefix: string;
        numberValidator: RegExp;
    };
};
export declare class Version {
    path: string;
    isCustom: boolean;
    isSourceDirectory: boolean;
    versionType: keyof typeof versionUrls | null;
    versionNumber: string | null;
    static builtJarLocation: string;
    constructor(path: string, isCustom: boolean, isSourceDirectory: boolean, versionType?: keyof typeof versionUrls | null, versionNumber?: string | null);
    static fromInput(version: string, state: State): Promise<Version>;
    jarFilePath(): string;
    exists(): boolean;
    name(): string;
    getDownloadUrl(): Promise<{
        url: string;
        jarName: string;
    }>;
    download(state: State): Promise<boolean>;
    static getLatestVersion(name: keyof typeof versionUrls): Promise<string>;
}
export declare function compileDirectory(path: string): Promise<boolean>;
export declare function launch(state: State): void;
export declare function handleCommand(input: string, state: State): void;
/**Returns a State given process args. */
export declare function init(opts: LaunchOptions, app: Application): State;
