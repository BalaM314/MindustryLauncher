import * as fs from "fs";
import { ChildProcess, spawn } from "child_process";


process.chdir(`C:\\coding\\Node.js\\MindustryLauncher`);

const settings: {
	mindustryJars: {
		folderPath: string;
		versionNames: {
			[index: string]: string;
		}
	};
	jvmArgs: string[];
	externalMods: string[];
} = JSON.parse(fs.readFileSync("config.json", "utf-8"));

let mindustryProcess:ChildProcess;



function parseArgs(args: string[]){
	let parsedArgs: {
		[index: string]: string;
	} = {};
	let argName:string = "null";
	for (let arg of args) {
		if(arg.startsWith("--")){
			argName = arg.slice(2);
			parsedArgs[arg.toLowerCase().slice(2)] = "null";
		} else if(argName){
			parsedArgs[argName] = arg.toLowerCase();
			argName = "null";
		}
	}
	return parsedArgs;
}

function startProcess(_filePath: string, _jvmArgs: string[]){
	let proc = spawn("java", [`-jar ${_filePath}`].concat(_jvmArgs).join(" ").split(" "));
	proc.stdout?.on("data", (data) => {
		process.stdout.write(data);
	});

	proc.stderr?.on("data", (data) => {
		process.stderr.write(data);
	});
	return proc;
}

function restart(_filePath: string, _jvmArgs: string[]){
	console.log("Restarting!");
	mindustryProcess.removeAllListeners();
	mindustryProcess.kill("SIGTERM");
	mindustryProcess = startProcess(_filePath, _jvmArgs);
	console.log("Started new process.");
}

function copyMods(){
	for(var file of settings.externalMods){
		console.log(`Copying mod ${file}`);
		let modname = file.match(/(?<=[/\\])[^/\\:*?"<>]+?(?=(Desktop)?\.jar$)/i);//hello regex my old friend
		if(modname == null){
			throw new Error(`Invalid mod filename ${file}!`);
		}
		fs.copyFileSync(file, `${process.env["appdata"]}\\Mindustry\\mods\\${modname[0]}.jar`);
	}
}

function main(){
	let state = "normal";

	for(let [version, jarName] of Object.entries(settings.mindustryJars.versionNames)){
		if(jarName.includes(" ")){
			throw new Error(`Jar name for version ${version} contains a space.`);
		}
	}

	let parsedArgs: {
		[index: string]: string;
	} = parseArgs(process.argv.slice(2));


	if(parsedArgs["help"]){
		console.log(
	`Usage: mindustry [--help] [--version <version>]
	--help\tDisplays this help message and exits.
	--version\tSpecifies the version to use.`
		);
		process.exit();
	}

	let jarName = settings.mindustryJars.versionNames[parsedArgs["version"]] ?? settings.mindustryJars.versionNames["135"];
	let filePath = jarName.match(/[/\\]/gi) ? jarName : settings.mindustryJars.folderPath + jarName;

	console.log(`Launching Mindustry version ${settings.mindustryJars.versionNames[parsedArgs["version"]] ? parsedArgs["version"] : "135"}`)


	copyMods();

	mindustryProcess = startProcess(filePath, settings.jvmArgs);

	process.stdin.on("data", (data) => {
		switch(data.toString("utf-8").slice(0, -2)){
			case "rs": case "restart":
				restart(filePath, settings.jvmArgs);
			break;
			default:
				console.log("Unknown command.");
				break;
		}
	});

	mindustryProcess.on("exit", (statusCode) => {
		if(statusCode == 0){
			console.log("Process exited.");
		} else {
			console.log(`Process crashed with exit code ${statusCode}!`);
		}
		process.exit();
	});


	for(var file of settings.externalMods){
		fs.watchFile(file, () => {
			console.log(`File change detected! (${file}) Restarting...`);
			copyMods();
			restart(filePath, settings.jvmArgs);
		});
	}
}

main();