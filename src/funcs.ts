/* @license
Copyright © <BalaM314>, 2024.
This file is part of MindustryLauncher.
MindustryLauncher is free software: you can redistribute it and/or modify it under the terms of the GNU Lesser General Public License as published by the Free Software Foundation, either version 3 of the License, or (at your option) any later version.
MindustryLauncher is distributed in the hope that it will be useful, but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the GNU Lesser General Public License for more details.
You should have received a copy of the GNU Lesser General Public License along with MindustryLauncher. If not, see <https://www.gnu.org/licenses/>.

Contains various util functions and other things.
*/

import * as fs from "fs";
import * as https from "https";
import * as path from "path";
import * as readline from "readline";
import { spawn, SpawnOptions, SpawnSyncReturns } from "child_process";
import { Transform, TransformCallback, TransformOptions } from "stream";

export const ANSIEscape = {
	"red": `\u001b[0;31m`,
	"yellow": `\u001b[0;93m`,
	"green": `\u001b[0;92m`,
	"blue": `\u001b[0;34m`,
	"purple": `\u001b[0;35m`,
	"white": `\u001b[0;97m`,
	"gray": `\u001b[0;90m`,
	"black": `\u001b[0;30m`,
	"cyan": `\u001b[0;36m`,
	"reset": `\u001b[0m`,
	"brightpurple": `\u001b[0;95m`
};
const commandColor = ANSIEscape.reset;

export function log(message:string){
	console.log(`${ANSIEscape.blue}[Launcher]${ANSIEscape.reset} ${message}${commandColor}`);
}
export function error(message:string){
	console.error(`${ANSIEscape.blue}[Launcher]${ANSIEscape.red} ${message}${commandColor}`);
}
export function debug(message:string){
	console.debug(`${ANSIEscape.gray}[DEBUG]${ANSIEscape.reset} ${message}${commandColor}`);
}

export function crash(message:string):never {
	throw new Error(message);
}



/**Returns the proper highlight color for a line based on the character inside [x] */
export function getLogHighlight(char:string | undefined){
	switch(char){
		case "I":
			return ANSIEscape.white;
		case "D":
			return ANSIEscape.gray;
		case "W":
			return ANSIEscape.yellow;
		case "E":
			return ANSIEscape.red;
		default:
			return ANSIEscape.white;
	}
}
export function getTimeComponent(color:boolean){
	if(color)
		return `${ANSIEscape.cyan}[${new Date().toTimeString().split(" ")[0]}]`;
	else
		return `[${new Date().toTimeString().split(" ")[0]}]`;
}
export function formatLine(line:string){
	return `${getTimeComponent(true)} ${getLogHighlight(line[1])}${line}${commandColor}`;
}

/**Creates a subclass of Transform from a function that processes one line at a time. */
export function streamTransform(transformFunction: (text:string, chunkIndex:number) => string){
	return streamTransformState<never>((text, chunkIndex) => [transformFunction(text, chunkIndex), null!]);
}

/**Creates a subclass of Transform from a function that processes one line at a time. */
export function streamTransformState<T>(
	transformFunction: (text:string, chunkIndex:number, state:T | null) => [output:string, state:T],
	def:T | null = null
):new (opts?:TransformOptions) => Transform {
	return class extends Transform {
		private _line: string;
		private state: T | null;
		constructor(opts?:TransformOptions){
			super(opts);
			this._line = "";
			this.state = def;
		}
		override _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback): void {
			this._line += chunk.toString();
			const lines = this._line.split(/\r?\n/);
			callback(
				null,
				lines
					.slice(0, -1)
					.map(line => line + "\n")
					.map((text, chunkIndex) => {
						const [out, state] = transformFunction(text, chunkIndex, this.state);
						this.state = state;
						return out;
					})
					.join("")
			);
			this._line = lines.at(-1)!;
		}
	};
}

export const LoggerHighlightTransform = streamTransformState<string | null>(
	(line, index, state) => {
		const output = line.match(/^\[\w\]/) || index == 0 ? formatLine(line) : `${state ?? ""}:          ${line}${commandColor}`;
		if(line.match(/^\[(\w)\]/)){
			state = getLogHighlight(line.match(/^\[(\w)\]/)![1]);
		}
		return [output, state];
	}, ANSIEscape.white
);
export function prependTextTransform(text: string | (() => string)){
	return streamTransform((line) => `${text instanceof Function ? text() : text} ${line}`);
}

/**Removes a word from logs. Useful to hide your Windows username.*/
export class CensorKeywordTransform extends Transform {
	constructor(public keyword:string | RegExp, public replace:string, opts?:TransformOptions){
		super(opts);
	}
	override _transform(chunk: Buffer, encoding: BufferEncoding, callback: TransformCallback):void {
		callback(null, chunk.toString().replaceAll(this.keyword, this.replace));
	}
}

/**
 * Keeps a running average of some data.
 */
export class WindowedMean {
	/** Queue to hold the data. */
	data:Array<[number, number]>;
	/** Index of the next place to insert an item into the queue. */
	queuei = 0;
	lastTime = -1;
	
	constructor(public maxWindowSize:number){
		this.data = Array.from({length: maxWindowSize}, () => [0, 0]);
	}

	add(value:number){
		if(this.lastTime != -1){
			this.data[this.queuei++ % this.maxWindowSize] = [value, Math.max(1, Date.now() - this.lastTime)];
		} //if there is no last time, discard the value
		this.lastTime = Date.now();
	}
	mean(windowSize?:number):number | null;
	mean<T>(windowSize:number, notEnoughDataValue:T):number | T;
	mean<T>(windowSize = this.maxWindowSize, notEnoughDataValue?:T):number | T | null {
		if(this.queuei < windowSize) return notEnoughDataValue ?? null; //overload 1
		if(windowSize > this.maxWindowSize) throw new Error(`Cannot get average over the last ${windowSize} values becaue only ${this.maxWindowSize} values are stored`);
		let total = 0;
		const wrappedQueueI = this.queuei % this.maxWindowSize;
		for(let i = wrappedQueueI - windowSize; i < wrappedQueueI; i ++){
			if(i >= 0) total += this.data[i]![0] / this.data[i]![1];
			else total += this.data[this.maxWindowSize + i]![0] / this.data[this.maxWindowSize + i]![1];
		}
		return total / windowSize;
	}
}


export function askQuestion(query:string):Promise<string> {
	const rl = readline.createInterface({
		input: process.stdin,
		output: process.stdout,
	});

	return new Promise(resolve => rl.question(query, ans => {
		rl.close();
		resolve(ans);
	}));
}

export async function askYesOrNo(query:string):Promise<boolean> {
	const response = await askQuestion(query);
	return response == "y" || response == "yes";
}

/**Copies a directory recursively. */
export function copyDirectory(source:string, destination:string, exclude = ""){
	if(path.basename(source) == exclude) return;
	fs.mkdirSync(destination, {recursive: true});
	fs.readdirSync(source, {withFileTypes: true}).forEach(entry => {
		const sourcePath = path.join(source, entry.name);
		const destinationPath = path.join(destination, entry.name);

		if(entry.isDirectory()){
			copyDirectory(sourcePath, destinationPath, exclude);
		} else {
			fs.copyFileSync(sourcePath, destinationPath);
		}
	});
}

export function parseJSONC(data:string):unknown {
	return JSON.parse(data.split("\n")
		.filter(line => !/^[ \t]*\/\//.test(line))
		//Removes lines that start with any amount of whitespaces or tabs and two forward slashes(comments).
		.map(line => line.replace(/\*.*?\*/g, ""))
		//Removes "multiline" comments.
		.join("\n")
	);
}

export function throwIfError(output:SpawnSyncReturns<Buffer>){
	if(output.error) throw output.error;
}

export function stringifyError(err:unknown):string {
	if(err instanceof Error) return err.message;
	else if(typeof err == "string") return err;
	else if(err === undefined) return "undefined";
	else if(err === null) return "null";
	else return "invalid error";
}

export function downloadFile(url:string, outputPath:string, changed?:(downloaded:number, total:number) => unknown){
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if(res.statusCode == 404){
				reject(`File does not exist.`);
			} else if(res.statusCode != 200){
				reject(`Expected status code 200, got ${res.statusCode}`);
			}
			const totalSize = Number(res.headers["content-length"]);
			const file = fs.createWriteStream(outputPath);
			if(!isNaN(totalSize)){
				let downloaded = 0;
				changed?.(downloaded, totalSize);
				res.on("data", (chunk) => {
					if(chunk instanceof Buffer){
						downloaded += chunk.length;
						changed?.(downloaded, totalSize);
					}
				});
			}
			res.pipe(file);
			file.on('finish', () => {
				file.close();
				resolve("File downloaded!");
			});
		});
	});
}

export function formatFileSize(bytes:number, b = 'B'):string {
	if(bytes < 1e3) return `${bytes} ${b}`;
	if(bytes < 1e6) return `${(bytes / 1e3).toFixed(2)} K${b}`;
	if(bytes < 1e9) return `${(bytes / 1e6).toFixed(2)} M${b}`;
	else return `${(bytes / 1e9).toFixed(2)} G${b}`;
}

export function resolveRedirect(url:string):Promise<string> {
	return new Promise((resolve, reject) => {
		https.get(url, (res) => {
			if(res.statusCode != 302){
				if(res.statusCode == 404){
					reject("Version does not exist.");
				} else {
					reject(`Error: Expected status 302, got ${res.statusCode}`);
				}
			}
			if(res.headers.location){
				resolve(res.headers.location);
			} else {
				reject(`Error: Server did not respond with redirect location.`);
			}
		});
	});
}

/** @throws NodeJS.Signals | Error */
export function spawnAsync(command:string, args:readonly string[], options:SpawnOptions = {}){
	const proc = spawn(command, args, options);
	return new Promise<void>((resolve, reject) => {
		proc.on("error", reject);
		proc.on("exit", (code, signal) => {
			if(code == null) reject(signal);
			if(code !== 0) reject(new Error(`Non-zero exit code: ${code}`));
			resolve();
		});
	});
}

/**
 * Allows lazily computing properties of an object.
 * Example usage:
 * ```
 * const foo = memoizeGetters({
 * 	prop1(){
 * 		console.log('reading file');
 * 		return fs.readFileSync('file.json', 'utf-8');
 * 	},
 * 	prop2(){
 * 		console.log('parsing json');
 * 		return JSON.parse(this.prop1());
 * 	}
 * });
 * 
 * //Functions are converted to getter properties
 * doSomething(foo.prop1); //outputs 'reading file'
 * doSomething(foo.prop2); //outputs 'parsing json', but not 'reading file'
 * doSomething(foo.prop2); //outputs nothing
 * ```
 */
export function memoizeGetters<T extends Record<string, unknown>>(
	input: {[K in keyof T]: () => T[K]}
){
	const cache: Record<string, unknown> = Object.create(null);
	const functionsObject = Object.fromEntries(Object.entries(input).map(([k, v]) => [k, () => {
		if(k in cache) return cache[k];
		return cache[k] = v.call(functionsObject);
	}]));
	return Object.defineProperties({}, Object.fromEntries(Object.entries(functionsObject).map(([k, v]) => [k, {
		configurable: true,
		enumerable: true,
		get: v,
		set(x){ cache[k] = x; },
	}]))) as T;
}
