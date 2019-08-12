import {promises as FSP, constants as FSC} from "fs"


export async function mkdir(dirname) {
    // access dir
    return FSP.access(dirname,FSC.W_OK)
    // if error, then make dir
        .catch(()=>FSP.mkdir(dirname))
        // return dir
        .then(()=>dirname)
}

export function memoize(fun) {
    const memo = new Map()
    const slice = Array.prototype.slice
    return function() {
        const args = slice.call(arguments)
        if(!(args in memo)) {
            memo[args] = fun.apply(this, args)
        }
        return memo[args]
    }
}

export function log() {
    console.log.call(null,...arguments)
}

export function printUsage(tasks) {
    console.log("node test1.js <taskname>")
    Object.keys(tasks)
        .filter(task => task[0] !== '_')
        .forEach((taskName)=>{
            console.log(`    ${taskName}`)
        })
}

export function printMissingTask(taskname) {
    console.log(`no task with name "${taskname}"`)
}

export function runTask(args, tasks) {
    const taskName = process.argv[2]
    if (!taskName) return printUsage(tasks)
    if (!tasks[taskName]) return printMissingTask(taskName)
    tasks[taskName](...args.slice(1))
}
