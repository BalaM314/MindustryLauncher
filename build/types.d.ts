import { ChildProcess } from "child_process";
import * as fs from "fs";
import type { Version } from "./mindustrylauncher.js";
export type Settings = {
    defaultVersionName?: string;
    mindustryJars: {
        folderPath: string;
        customVersionNames: Record<string, string>;
    };
    jvmArgs: string[];
    javaPath?: string;
    processArgs: string[];
    externalMods: string[];
    restartAutomaticallyOnModUpdate: boolean;
    restartAutomaticallyOnRequest: boolean;
    watchWholeJavaModDirectory: boolean;
    buildModsConcurrently: boolean;
    logging: {
        path: string;
        enabled: boolean;
        removeUsername: boolean;
        removeUUIDs: boolean;
    };
};
export type State = {
    settings: Settings;
    settingsOrErr: Settings | [unknown];
    /**The path of the Mindustry data directory. */
    mindustryDirectory: string;
    /**The path of the Mindustry mods directory. */
    modsDirectory: string;
    /**The path of the folder used to store launcher data. */
    launcherDataPath: string;
    /**The current user's username, used to censor it in log output. */
    username: string | null;
    settingsPath: string;
    /** The java command to use. */
    javaPath: string;
    mindustryProcess: ChildProcess | null;
    currentLogStream: fs.WriteStream | null;
    mindustryArgs: string[];
    jvmArgs: string[];
    version: Version;
    externalMods: Array<{
        path: string;
        type: "file" | "dir" | "java" | "invalid";
    }>;
    buildMods: boolean;
    /** The most recent time we saw an "Exiting to reload game." message. If the game exits within 2 seconds of this message, we will restart it automatically. Otherwise, we assume it's fake. */
    restartRequestedAt: number | null;
};
export type LaunchOptions = {
    commandName: string;
    namedArgs: {
        version?: string | null;
        buildMods?: boolean;
        info?: boolean;
        path?: boolean;
    };
    positionalArgs: string[];
};
