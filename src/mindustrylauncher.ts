/**
Copyright © <BalaM314>, 2022.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains functions that are part of the program code.
*/



import * as path from "path";
import * as fs from "fs";
import { promises as fsP } from "fs";
import * as os from "os";
import { spawn, execSync } from "child_process";
import { Application, Options } from "cli-app";
import {
	prependTextTransform, getTimeComponent, CensorKeywordTransform, LoggerHighlightTransform,
	log, error, fatal, copyDirectory, downloadFile, parseJSONC, ANSIEscape, resolveRedirect,
	stringifyError
} from "./funcs.js";
import { State, Settings } from "./types.js";
import { info } from "console";




function startProcess(state:State){
	const proc = spawn(
		"java",
		[...state.jvmArgs, `-jar`, state.version.jarFilePath(), ...state.mindustryArgs],
		{ shell: false }
	);
	const d = new Date();

	if(state.settings.logging.enabled){
		state.currentLogStream = fs.createWriteStream(
			path.join(
				`${state.settings.logging.path}`,
				`${d.getFullYear()}-${d.getMonth()+1}-${d.getDate()}--${d.getHours()}-${d.getMinutes()}-${d.getSeconds()}.txt`
			)
		);
		//Creates a write stream and pipes the output of the mindustry process into it.
		if(state.settings.logging.removeUsername && state.username != null)
			proc.stdout
				.pipe(new (prependTextTransform(() => getTimeComponent(false))))
				.pipe(new CensorKeywordTransform(state.username, "[USERNAME]"))
				.pipe(state.currentLogStream);
		else
			proc.stdout
				.pipe(new (prependTextTransform(() => getTimeComponent(false))))
				.pipe(state.currentLogStream);
	}
	if(state.settings.logging.removeUsername && state.username != null){
		[proc.stdout, proc.stderr].forEach(stream => stream
			.pipe(new LoggerHighlightTransform())
			.pipe(new CensorKeywordTransform(state.username!, "[USERNAME]"))
			.pipe(process.stdout)
		);
	} else {
		[proc.stdout, proc.stderr].forEach(stream => stream
			.pipe(new LoggerHighlightTransform())
			.pipe(process.stdout)
		);
	}

	proc.on("exit", (statusCode) => {
		if(statusCode == 0){
			log("Process exited.");
		} else {
			log(`Process crashed with exit code ${statusCode}!`);
		}
		process.exit();
	});
	
	return proc;
}

/**Restarts the mindustry process. */
async function restart(state:State, build:boolean, compile:boolean){
	if(build && compile){
		error("How were you able to trigger a rebuild and a recompile at the same time? Restarting...");
	} else if(build){
		log("Rebuilding mods and restarting...");
	} else if(compile){
		log("Recompiling client...");
	} else {
		log("Restarting...");
	}
	state.mindustryProcess?.removeAllListeners();
	state.mindustryProcess?.kill("SIGTERM");//todo see if this causes issues
	state.buildMods = build;
	if(compile){
		if(state.version.isSourceDirectory){
			const successful = await compileDirectory(state.version.path);
			if(!successful){
				error("Build failed.");
				process.exit(1);
			}
		} else {
			error("Cannot compile, launched version did not come from a source directory.");
		}
	}
	copyMods(state);
	state.mindustryProcess = startProcess(state);
	log("Started new process.");
}

export async function copyMods(state:State){
	const modTasks = state.externalMods.map(async mod => {
		if(mod.type == "java"){
			//Maybe build the directory
			if(state.buildMods){
				log(`Building and copying java mod directory "${mod.path}"`);
				const preBuildTime = Date.now();
				try {
					execSync("gradlew jar", {
						cwd: mod.path
					});
				} catch(err){
					fatal(`Build failed!`);
				}
				const timeTaken = Date.now() - preBuildTime;
				log(`Built "${path.basename(mod.path)}" in ${timeTaken.toFixed(0)}ms`);
			} else {
				log(`Copying java mod directory "${mod.path}"`);
			}
			
			const modFileName = (await fsP.readdir(path.join(mod.path, "build", "libs")))
				.filter(n => n.endsWith(".jar"))[0];
			const modFilePath = path.join(mod.path, "build", "libs", modFileName);
			if(!fs.existsSync(modFilePath)){
				if(state.buildMods){
					error(`Java mod directory "${mod.path}" does not have a mod file in build/libs/, skipping copying. There may be an issue with your mod's build.gradle file.`);
				} else {
					error(`Java mod directory "${mod.path}" does not have a mod file in build/libs/, skipping copying. This may be because the mod has not been built yet. Run "gradlew jar" to build the mod, or specify --buildMods.`);
				}
			} else {
				const modName = modFileName.match(/[^/\\:*?"<>]+?(?=(Desktop?\.jar$))/i)?.[0];
				await fsP.copyFile(
					modFilePath,
					path.join(state.modsDirectory, modName + ".jar")
				);
			}

		} else if(mod.type == "dir"){
			//Copy the whole directory
			log(`Copying mod directory "${mod.path}"`);
			copyDirectory(mod.path, path.join(state.modsDirectory, path.basename(mod.path)), ".git");
		} else if(mod.type == "file"){
			//Copy the mod file
			let modname = path.basename(mod.path).split(".").slice(0, -1).join(".");
			if(modname == "") modname = path.basename(mod.path);
			log(`Copying modfile "${mod.path}"`);
			fs.copyFileSync(mod.path, path.join(state.modsDirectory, modname[0] + path.extname(mod.path)));
		}
	});

	if(state.settings.buildModsConcurrently) await Promise.all(modTasks);
	else for(const modTask of modTasks){ await modTask; }
}

export const versionUrls: {
	[type:string]: {
		/**Returns url to .jar file given version number. */
		url: (version:string) => string;
		/**Contains data used to get the latest version: $[0] is a redirect to resolve, and $[1] is a regex that returns the version number from the resolved redirect in the first capture group. */
		getLatestVersion: [string, RegExp];
		/**The text before the version, for example "foo-" in foo-1202. Can be "".*/
		prefix: string;
		numberValidator: RegExp
	};
} = {
	foo: {
		url: version => `https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/download/${version}/desktop.jar`,
		getLatestVersion: [`https://github.com/mindustry-antigrief/mindustry-client-v7-builds/releases/latest`, /(?<=\/tag\/)(\d+)/],
		prefix: "foo-",
		numberValidator: /^(\d+|latest)$/d,
	},
	"foo-v6": {
		url: version => `https://github.com/mindustry-antigrief/mindustry-client-v6-builds/releases/download/${version}/desktop.jar`,
		getLatestVersion: [`https://github.com/mindustry-antigrief/mindustry-client-v6-builds/releases/latest`, /(?<=\/tag\/)(\d+)/],
		prefix: "foo-v6-",
		numberValidator: /^(\d+|latest)$/d,
	},
	be: {
		url: version => `https://github.com/Anuken/MindustryBuilds/releases/download/${version}/Mindustry-BE-Desktop-${version}.jar`,
		getLatestVersion: [`https://github.com/Anuken/MindustryBuilds/releases/latest`, /(?<=\/tag\/)(\d+)/],
		prefix: "be-",
		numberValidator: /^(\d+|latest)$/d,
	},
	vanilla: {
		url: version => `https://github.com/Anuken/Mindustry/releases/download/v${version}/Mindustry.jar`,
		getLatestVersion: [`https://github.com/Anuken/Mindustry/releases/latest`, /(?<=\/tag\/v)(\d+(?:\.\d)?)/],
		prefix: "",
		numberValidator: /^(\d+(?:\.\d+)?|latest)$/d,
	},
};

export class Version {
	static builtJarLocation = "desktop/build/libs/Mindustry.jar";
	constructor(
		public path: string,
		public isCustom: boolean,
		public isSourceDirectory: boolean,
		public versionType: string | null = null,
		public versionNumber: string | null = null
	){}
	static async fromInput(version:string, state:State){
		let
			filepath:string,
			isCustom:boolean = false,
			isSourceDirectory:boolean = false,
			versionType:string | null = null,
			versionNumber:string | null = null
		;
		if(state.settings.mindustryJars.customVersionNames[version]){
			isCustom = true;
			filepath = state.settings.mindustryJars.customVersionNames[version];
			if(!fs.existsSync(filepath)) fatal(`Invalid custom version ${version}: specified filepath ${path} does not exist.`);
			if(fs.lstatSync(filepath).isDirectory()){
				try {
					fs.accessSync(path.join(filepath, "/desktop/build.gradle"));
				} catch(err){
					fatal(`Invalid custom version ${version}: Unable to find a build.gradle in ${path}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
				}
				isSourceDirectory = true;
			}
		} else {
			for(const [name, versionData] of Object.entries(versionUrls)){
				if(version.startsWith(versionData.prefix)){
					const potentialVersionNumber = version.replace(versionData.prefix, "");
					if(!versionData.numberValidator.test(potentialVersionNumber)) continue;
					versionType = name;
					versionNumber = potentialVersionNumber;
				}
			}
			if(versionType == null || versionNumber == null) fatal(`Invalid version ${version}`);
			if(versionNumber == "latest"){
				info(`Getting latest ${versionType} version...`);
				versionNumber = await this.getLatestVersion(versionType);
				info(`Resolved version ${version} to ${versionType}-${versionNumber}`);
			}
			filepath = path.join(state.settings.mindustryJars.folderPath, `v${versionUrls[versionType].prefix}${versionNumber}.jar`);
		}
		return new this(filepath, isCustom, isSourceDirectory, versionType, versionNumber);
	}
	jarFilePath(){
		if(this.isSourceDirectory){
			return path.join(this.path, Version.builtJarLocation);
		} else {
			return this.path;
		}
	}
	exists():boolean {
		return fs.existsSync(this.jarFilePath());
	}
	name(){
		if(this.isSourceDirectory) return `[Source directory at ${this.path}]`;
		if(this.isCustom) return `[custom version]`;
		if(!this.versionNumber || !this.versionType) fatal("versionNumber should exist");
		return `${this.versionType}-${this.versionNumber}`;
	}
	async getDownloadUrl(){
		if(this.versionType == null || this.versionNumber == null) throw new Error(`Logic error caused by ${this.versionType} at lookupDownloadUrl`);
		const versionData = versionUrls[this.versionType];
		log(`Looking up download url for ${this.versionType} version ${this.versionNumber}`);
		if(this.versionNumber == "latest") throw new Error("Logic error: version's number was 'latest'.");
		return {
			url: await resolveRedirect(versionData.url(this.versionNumber)),
			jarName: `v${versionData.prefix}${this.versionNumber}.jar`
		};
	}
	async download(state:State):Promise<boolean> {
		try {
			const { url, jarName } = await this.getDownloadUrl();
			const filePath = path.join(state.settings.mindustryJars.folderPath, jarName);
			log("Downloading...");
			await downloadFile(url, filePath);
			log(`File downloaded to ${filePath}.`);
			return true;
		} catch(err){
			error("Download failed: " + stringifyError(err));
			return false;
		}
	}
	static async getLatestVersion(name:string):Promise<string> {
		const versionData = versionUrls[name];
		const resolvedUrl = await resolveRedirect(versionData.getLatestVersion[0]);
		const result = versionData.getLatestVersion[1].exec(resolvedUrl);
		if(result == null || result[1] == undefined)
			throw new Error(`regex /${versionData.getLatestVersion[1].source}/ did not match resolved url ${resolvedUrl} for version ${name}`);
		return result[1];
	}
}

export async function compileDirectory(path:string):Promise<boolean> {
	try {
		fs.accessSync(`${path}/desktop/build.gradle`);
	} catch(err){
		error(`Unable to find a build.gradle in ${path}/desktop/build.gradle. Are you sure this is a Mindustry source directory?`);
		return false;
	}
	log("Compiling...");
	const gradleProcess = spawn(`${path}/gradlew.bat`, ["desktop:dist"], {
		cwd: path
	});
	[gradleProcess.stdout, gradleProcess.stderr].forEach(stream => stream
		.pipe(new (prependTextTransform(`${ANSIEscape.brightpurple}[Gradle]${ANSIEscape.reset}`)))
		.pipe(process.stdout)
	);
	//Fancy promise stuff, wait until gradle exits
	const code = await new Promise<number>(res => gradleProcess.on("exit", res));
	if(code == 0){
		log("Compiled succesfully.");
		return true;
	} else {
		log("Compiling failed.");
		return false;
	}
}

export function launch(state:State){
	
	log(`Launching Mindustry version ${state.namedArgs["version"]}`);
	if(state.mindustryArgs.length > 0){
		log(`Arguments: ${state.mindustryArgs}`);
	}

	state.mindustryProcess = startProcess(state);

	//Apply command handler
	process.stdin.on("data", data => handleCommand(data.toString().slice(0, -2), state));

	//Apply more handlers
	if(state.settings.restartAutomaticallyOnModUpdate){
		for(const mod of state.externalMods){
			if(mod.type == "file")
				fs.watchFile(mod.path, () => {
					log(`File change detected! (${mod.path})`);
					restart(state, true, false);
				});
			else if(mod.type == "dir")
				fs.watchFile(mod.path, () => {
					log(`File change detected! (${mod.path})`);
					restart(state, true, false);
				});
			else if(mod.type == "java")
				fs.watchFile(state.settings.watchWholeJavaModDirectory ? mod.path : path.join(mod.path, "build/libs"), () => {
					log(`File change detected! (${mod.path})`);
					restart(state, true, false);
				});
		}
	}

}

export function handleCommand(input:string, state:State){
	switch(input.split(" ")[0]){
		case "rs": case "restart":
			restart(state, false, false);
			break;
		case "rb": case "rebuild":
			restart(state, true, false);
			break;
		case "rc": case "recompile":
			restart(state, false, true);
			break;
		case "?": case "h": case "help":
			log(`Commands: 'restart/rs', 'rebuild/rb', 'recompile/rc', 'help/h/?', 'exit/e'`);
			break;
		case "exit": case "e":
			log("Exiting...");
			state.mindustryProcess?.removeAllListeners();
			state.mindustryProcess?.kill("SIGTERM");
			process.exit(0);
			break;
		case "pass": case "-": case "p":
			if(state.mindustryProcess?.stdin?.writable){
				state.mindustryProcess.stdin.write(input.split(" ").slice(1).join(" ") + "\r\n");
			} else {
				log("Error: Stream not writeable.");
			}
			break;
		default:
			log("Unknown command.");
			break;
	}
}

function validateSettings(input:any, username:string | null):asserts input is Settings {
	if(!(input instanceof Object)) throw new Error("settings is not an object");
	const settings = input as Settings;
	try {
		for(const [version, jarName] of Object.entries(settings.mindustryJars.customVersionNames)){
			if(jarName.includes(" ")){
				error(`Jar name for version ${version} contains a space.`);
				error(`Run "mindustry config" to change settings.`);
				process.exit(1);
			}
		}

		if(!fs.existsSync(settings.logging.path)){
			throw new Error(`Logging path "${settings.logging.path}" does not exist.`);
		}
		if(!fs.lstatSync(settings.logging.path).isDirectory()){
			throw new Error(`Logging path "${settings.logging.path}" is not a directory.`);
		}

		if(username == null && settings.logging.removeUsername){
			error("Could not determine your username, disabling logging.removeUsername");
			settings.logging.removeUsername = false;
		}

		if(!(fs.existsSync(settings.mindustryJars.folderPath) && fs.lstatSync(settings.mindustryJars.folderPath).isDirectory())){
			error(`Specified path to put Mindustry jars (${settings.mindustryJars.folderPath}) does not exist or is not a directory.\n`);
			error(`Run "mindustry config" to change settings.`);
			process.exit(1);
		}
	} catch(err:any){
		throw new Error("Invalid settings: " + err.message);
	}
}

/**Returns a State given process args. */
export function init(opts:Options, app:Application):State {
	//Change working directory to the same as this program's index.js file
	process.chdir(app.sourceDirectory);

	//Get a bunch of static things
	const mindustryDirectory =
	process.platform == "win32" ? path.join(process.env["APPDATA"]!, "Mindustry/") :
		process.platform == "darwin" ? path.join(os.homedir(), "/Library/Application Support/Mindustry/") : 
			process.platform == "linux" ? path.normalize((process.env["XDG_DATA_HOME"] ?? path.join(os.homedir(), "/.local/share")) + "/Mindustry/") :
				fatal(`Unsupported platform ${process.platform}`);
	const modsDirectory = path.join(mindustryDirectory, "mods");
	const launcherDataPath = path.join(mindustryDirectory, "launcher");
	const username = process.env["USERNAME"] ?? process.env["USER"] ?? null;

	//if settings file doesn't exist, 
	if(!fs.existsSync(path.join(launcherDataPath, "config.json"))){
		log("No config.json file found, creating one. If this is your first launch, this is fine.");
		if(!fs.existsSync(launcherDataPath)){
			fs.mkdirSync(launcherDataPath, {
				recursive: true
			});
		}
		fs.copyFileSync("template-config.json", path.join(launcherDataPath, "config.json"), fs.constants.COPYFILE_EXCL);
		if(opts.commandName != "config") log("Currently using default settings: run `mindustry config` to edit the settings file.");
	}
	
	const settings = parseJSONC(fs.readFileSync(path.join(launcherDataPath, "config.json"), "utf-8")) as Settings;

	if(opts.commandName != "config") validateSettings(settings, username);

	const externalMods = settings.externalMods.map(modPath => ({
		path: modPath,
		type: fs.existsSync(modPath) ?
			fs.lstatSync(modPath).isDirectory() ?
				fs.existsSync(path.join(modPath, "build.gradle")) ? "java" : "dir"
				: "file"
			: (error(`External mod "${modPath}" does not exist.`), "invalid") as "java" | "dir" | "file" | "invalid"
	}));

	return {
		settings,
		currentLogStream: null,
		launcherDataPath,
		mindustryDirectory,
		mindustryProcess: null,
		modsDirectory,
		username,
		namedArgs: opts.namedArgs,
		mindustryArgs: settings.processArgs,
		jvmArgs: settings.jvmArgs.concat(opts.positionalArgs),
		externalMods,
		buildMods: "buildMods" in opts.namedArgs,
		version: null!//TODO this is probably bad
	};
}
