import type { Application } from "@balam314/cli-app";
import { LaunchOptions, State } from "./types.js";
export declare function copyMods(state: State): Promise<void>;
export declare const versionUrls: {
    [type: string]: {
        /**Returns url to .jar file given version number. */
        url: (version: string) => string;
        /**Contains data used to get the latest version: $[0] is a redirect to resolve, and $[1] is a regex that returns the version number from the resolved redirect in the first capture group. */
        getLatestVersion: [string, RegExp];
        /**The text before the version, for example "foo-" in foo-1202. Can be "".*/
        prefix: string;
        numberValidator: RegExp;
    };
};
export declare class Version {
    path: string;
    isCustom: boolean;
    isSourceDirectory: boolean;
    versionType: string | null;
    versionNumber: string | null;
    static builtJarLocation: string;
    constructor(path: string, isCustom: boolean, isSourceDirectory: boolean, versionType?: string | null, versionNumber?: string | null);
    static fromInput(version: string, state: State): Promise<Version>;
    jarFilePath(): string;
    exists(): boolean;
    name(): string;
    getDownloadUrl(): Promise<{
        url: string;
        jarName: string;
    }>;
    download(state: State): Promise<boolean>;
    static getLatestVersion(name: string): Promise<string>;
}
export declare function compileDirectory(path: string): Promise<boolean>;
export declare function launch(state: State): void;
export declare function handleCommand(input: string, state: State): void;
/**Returns a State given process args. */
export declare function init(opts: LaunchOptions, app: Application): State;
