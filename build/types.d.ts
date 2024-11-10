import { ChildProcess } from "child_process";
import * as fs from "fs";
import { Version } from "./mindustrylauncher";
export interface Settings {
    mindustryJars: {
        folderPath: string;
        customVersionNames: {
            [index: string]: string;
        };
    };
    jvmArgs: string[];
    processArgs: string[];
    externalMods: string[];
    restartAutomaticallyOnModUpdate: boolean;
    watchWholeJavaModDirectory: boolean;
    buildModsConcurrently: boolean;
    logging: {
        path: string;
        enabled: boolean;
        removeUsername: boolean;
        removeUUIDs: boolean;
    };
}
export interface State {
    settings: Settings;
    /**The path of the Mindustry data directory. */
    mindustryDirectory: string;
    /**The path of the Mindustry mods directory. */
    modsDirectory: string;
    /**The path of the folder used to store launcher data. */
    launcherDataPath: string;
    /**The current user's username, used to censor it in log output. */
    username: string | null;
    /**The named arguments passed to the program. */
    namedArgs: {
        [index: string]: string | undefined | null;
    };
    mindustryProcess: ChildProcess | null;
    currentLogStream: fs.WriteStream | null;
    mindustryArgs: string[];
    jvmArgs: string[];
    version: Version;
    externalMods: {
        path: string;
        type: "file" | "dir" | "java" | "invalid";
    }[];
    buildMods: boolean;
}
