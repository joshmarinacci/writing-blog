import {memoize, mkdir, runTask, log} from "./utils.js"
import fs, {promises as FSP, constants as FSC} from "fs"
import {basename, join as pathJoin, dirname as pathDirname, parse as pathParse, extname as pathExtname} from "path"
import unified from "unified"
import parseHtml from 'rehype-parse'
import stringifyHtml from 'rehype-stringify'
import visit from 'unist-util-visit-parents'

const OUTPUT_DIR = "output"
const BLOG_SOURCE = "posts"
const RESOURCES = 'resources'
const STYLESHEET = pathJoin(RESOURCES,'main.css')

async function calculateOutputPath(fullfile) {
    // console.log("full file is",fullfile, basename(fullfile))
    const content = await FSP.readFile(fullfile)
    const tree = await unified()
        .use(parseHtml, {emitParseErrors: true})
        .parse(content)

    const meta = {}
    visit(tree,(node)=>{
        if(node.tagName === 'meta') {
            if(!node.properties) return
            if(!node.properties.name) return
            if(node.properties && node.properties.name) {
                meta[node.properties.name] = node.properties.content
            }
        }
    })
    if(!meta.created) throw new Error(`document ${fullfile} is missing an created date`)
    const outpath = pathJoin(OUTPUT_DIR,meta.created,meta.slug+'.html')
    return {
        inpath:fullfile,
        outpath:outpath,
        stats:await FSP.stat(outpath).catch(()=>false),
        meta:meta,
    }
}

async function newer(target, sources) {
    // console.log("checking newer for", target, sources)
    if(!target.stats) return false
    // console.log("target is",target.stats.mtime)
    for (let i = 0; i < sources.length; i++) {
        const stat = await FSP.stat(sources[i])
        // console.log('dep stats is', stat.mtime)
        if(stat.mtime > target.stats.mtime) {
            // console.log("target is older")
            return false
        }
    }
    return true
}

async function parseBlogPost(fullfile) {
    console.log("parsing blog post",fullfile)
    const content = await FSP.readFile(fullfile)
    const tree = await unified()
        .use(parseHtml, {emitParseErrors: true})
        .parse(content)
    return tree
}

async function applyTemplate(tree, template) {
    visit(tree,(node)=>{
        //replace codeblock with pre code
        if(node.tagName === 'codeblock') {
            node.tagName = 'pre'
            const code = {
                type:'element',
                tagName:'code',
                children:node.children
            }
            node.children = [code]
        }
        if(node.tagName === 'head') {
            node.children.push(
                {
                    type:'element',
                    tagName:'link',
                    properties: {
                        rel:'stylesheet',
                        href:'../main.css'
                    }
                }
            )
        }
    })

}

async function mkdirsFor(outpath) {
    const dirs = pathParse(outpath).dir.split('/')
    const curr = []
    while (dirs.length >= 1) {
        curr.push(dirs.shift())
        // console.log("making dir for",curr.join("/"))
        await mkdir(curr.join("/"))
    }
}

async function writeTree(tree,output) {
    const html = await unified()
        .use(stringifyHtml)
        .stringify(tree)
    // console.log("got the output",html)
    console.log("writing to",output.outpath)
    await mkdirsFor(output.outpath)
    return FSP.writeFile(output.outpath,html)
}

async function processBlogPost(fullfile) {
    // console.log("processing",fullfile)
    const output = await calculateOutputPath(fullfile)
    // console.log("output file",output.outpath)
    const okay = await newer(output,[fullfile,STYLESHEET])
    if(okay) {
        console.log(`skipping:   ${fullfile}`)
        return output
    }
    console.log(`processing: ${output.outpath}`)
    const tree = await parseBlogPost(fullfile)
    //inserts common CSS files w/ the correct relative path
    await applyTemplate(tree)
    await writeTree(tree,output)
    return output
}

async function copyToDirIfNewer(source, OUTPUT_DIR) {
    const sourceStats = await FSP.stat(source).catch(()=>false)
    if(!sourceStats) throw new Error(`no such file to copy: ${source}`)
    const outfile = pathJoin(OUTPUT_DIR,basename(source))
    const outStats = await FSP.stat(outfile).catch(()=>false)
    if(outStats && outStats.mtime > sourceStats.mtime) {
        console.log(`skipping:   ${source}`)
        return
    }

    console.log(`copying ${source} to ${outfile}`)
    const data = await FSP.readFile(source)
    await FSP.writeFile(outfile,data)
    // console.log("comparing",outStats,sourceStats)
}

async function buildPosts() {
    let posts = await FSP.readdir(BLOG_SOURCE)
    posts = posts.filter(f => pathExtname(f) === '.html')
    posts = posts.map(f => pathJoin(BLOG_SOURCE,f))
    for (const file of posts) {
        await processBlogPost(file)
    }

    await copyToDirIfNewer(STYLESHEET,OUTPUT_DIR)
}
buildPosts().then(()=>console.log("all done"))
