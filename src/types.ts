/* @license
Copyright © <BalaM314>, 2024.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains the mindustrylauncher Application.
*/

import { ChildProcess } from "child_process";
import * as fs from "fs";
import { Version } from "./mindustrylauncher";



export type Settings = {
	mindustryJars: {
		folderPath: string;
		customVersionNames: Record<string, string>
	};
	jvmArgs: string[];
	javaPath?: string;
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

export type State = {
	settings: Settings;
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
	/**The named arguments passed to the program. */
	versionName: string;
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
}

export type LaunchOptions = {
	commandName: string;
	namedArgs: {
		version?: string;
		buildMods?: boolean;
		info?: boolean;
		path?: boolean;
	};
	positionalArgs: string[];
};
