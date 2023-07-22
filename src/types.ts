/**
Copyright © <BalaM314>, 2022.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains the mindustrylauncher Application.
*/

import { ChildProcess } from "child_process";
import * as fs from "fs";
import { Version } from "./mindustrylauncher";



export interface Settings {
	mindustryJars: {
		folderPath: string;
		customVersionNames: {
			[index: string]: string;
		}
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