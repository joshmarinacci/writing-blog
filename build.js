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
const LOGO = pathJoin(RESOURCES,'sign.small.png')
const BGIMG = pathJoin(RESOURCES,'funky-lines.png')
const POST_TEMPLATE = pathJoin(RESOURCES,'post.html')
const HEADER_TEMPLATE = pathJoin(RESOURCES,'header.html')
const ASIDE_TEMPLATE = pathJoin(RESOURCES,'aside.html')
const FOOTER_TEMPLATE = pathJoin(RESOURCES,'footer.html')
const CLEAN = {dirty:true}
const MAX_PARAGRAPHS_IN_INDEX = 4

async function calculateOutputPath(fullfile) {
    const tree = await parseHTMLFile(fullfile)
    const meta = {}
    visit(tree,(node)=>{
        if(node.tagName === 'meta') {
            if(!node.properties) return
            if(!node.properties.name) return
            if(node.properties && node.properties.name) {
                meta[node.properties.name] = node.properties.content
            }
        }
        if(node.tagName === 'title') {
            meta.title = node.children[0].value
        }
    })
    if(!meta.created) throw new Error(`document ${fullfile} is missing an created date`)
    const relpath = pathJoin(meta.created+'_'+meta.slug+'.html')
    const outpath = pathJoin(OUTPUT_DIR,relpath)
    return {
        inpath:fullfile,
        outpath:outpath,
        relpath:relpath,
        stats:await FSP.stat(outpath).catch(()=>false),
        meta:meta,
    }
}

async function newer(target, sources) {
    // console.log("checking newer for", target, sources)
    if(!target.stats) return false
    // console.log("target is",target.stats.mtime)
    for (let i = 0; i < sources.length; i++) {
        const source = sources[i]
        if(typeof source === 'object') {
            if(source.dirty) return false
            continue
        }
        const stat = await FSP.stat(source)
        // console.log('dep stats is', stat.mtime)
        if(stat.mtime > target.stats.mtime) {
            // console.log("target is older")
            return false
        }
    }
    return true
}

async function parseHTMLFile(fullfile) {
    const content = await FSP.readFile(fullfile)
    return unified()
        .use(parseHtml, {emitParseErrors: true})
        .parse(content)
}

async function parseHTMLFragment(fullfile) {
    const content = await FSP.readFile(fullfile)
    return unified()
        .use(parseHtml, {emitParseErrors: true, fragment: true})
        .parse(content)
}

async function applyTemplate(tree, template, post) {
    console.log("doing post",post)
    let header = await parseHTMLFragment(HEADER_TEMPLATE)
    let aside = await parseHTMLFragment(ASIDE_TEMPLATE)
    let footer = await parseHTMLFragment(FOOTER_TEMPLATE)

    let post_body = null
    visit(tree,(node)=>{
        if(node.tagName === 'body') {
            post_body = node
        }
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

    visit(template,node => {
        if(node.tagName === 'article') {
            node.children.push(H1(Text(post.meta.title)))
            node.children.push(...post_body.children)
        }
    })

    replaceElementWithFragment(template,'header',header)
    replaceElementWithFragment(template,'footer',footer)
    replaceElementWithFragment(template,'aside',aside)
}


function replaceElementWithFragment(tree,name,fragment) {
    visit(tree,node => {
        if(node.tagName === name) node.children = fragment.children[0].children
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
    output.template = await parseHTMLFile(POST_TEMPLATE)
    output.tree = await parseHTMLFile(fullfile)
    const newest = await newer(output,[fullfile,STYLESHEET,POST_TEMPLATE,CLEAN])
    if(newest) {
        console.log(`skipping:   ${fullfile}`)
        return output
    }
    console.log(`processing: ${output.outpath}`)
    //inserts common CSS files w/ the correct relative path
    await applyTemplate(output.tree,output.template, output)
    await writeTree(output.template,output)
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


function Text(str) {
    return {
        type:'text',
        value:str
    }
}
function Link(url,...rest) {
    return {
        type:'element',
        tagName:'a',
        properties:{href:url},
        children:rest
    }
}
function Element(name,...rest) {
    return {
        type:'element',
        tagName:name,
        children:rest
    }
}
const Article = (...rest) => Element('article', ...rest)
const Div = (...rest) => Element('div', ...rest)
const H1  = (...rest) => Element('h1',  ...rest)
const H2  = (...rest) => Element('h2',  ...rest)
const H3  = (...rest) => Element('h3',  ...rest)
const P  = (...rest) => Element('p',  ...rest)
const I  = (...rest) => Element('i',  ...rest)

function calculateSummaryNodes(tree) {
    let summary = []
    visit(tree,node => {
        if(node.tagName !== 'body') return
        // console.log("found a body",node)
        summary = node.children.slice(0,MAX_PARAGRAPHS_IN_INDEX)
    })
    return summary
}

async function generateIndex(posts) {
    // console.log("got",posts)
    const info = {
        inpath:'resources/index.html',
        outpath:pathJoin(OUTPUT_DIR,'index.html'),
    }
    posts.sort((a,b)=>{
        if(a.meta.created > b.meta.created) return -1
        if(a.meta.created < b.meta.created) return +1
        return 0
    })
    const indexTemplate = await parseHTMLFile(info.inpath)
    visit(indexTemplate,(node)=>{
        if(node.tagName === 'main') {
            posts.forEach(post => {
                const summary = calculateSummaryNodes(post.tree)
                node.children.push(
                    Article(
                        H1(
                            Link(post.relpath,Text(post.meta.title))
                        ),
                        ...summary,
                        Link(post.relpath,Text('read more...')),
                        I(Text(`written ${post.meta.created}`)),
                        ))
            })
        }
    })
    let header = await parseHTMLFragment(HEADER_TEMPLATE)
    let aside = await parseHTMLFragment(ASIDE_TEMPLATE)
    let footer = await parseHTMLFragment(FOOTER_TEMPLATE)
    replaceElementWithFragment(indexTemplate,'header',header)
    replaceElementWithFragment(indexTemplate,'aside',aside)
    replaceElementWithFragment(indexTemplate,'footer',footer)
    await writeTree(indexTemplate,info)
    console.log('writing index to',info.outpath)
}

const VALID_RESOURCES = ['.png','.svg','.jpg']
async function buildPosts() {
    let posts = await FSP.readdir(BLOG_SOURCE)
    posts = posts.filter(f => pathExtname(f) === '.html')
    posts = posts.map(f => pathJoin(BLOG_SOURCE,f))
    const outs = await (Promise.all(posts.map(file => processBlogPost(file))))
    await copyToDirIfNewer(STYLESHEET,OUTPUT_DIR)
    await copyToDirIfNewer(LOGO,OUTPUT_DIR)
    await copyToDirIfNewer(BGIMG,OUTPUT_DIR)
    let images = (await FSP.readdir(BLOG_SOURCE))
        .filter(f => VALID_RESOURCES.includes(pathExtname(f).toLowerCase()))
        .map(f => pathJoin(BLOG_SOURCE,f))
    console.log(images)
    images.forEach(async (img)=> {
        await copyToDirIfNewer(img,OUTPUT_DIR)
    })

    await generateIndex(outs)
}
buildPosts().then(()=>console.log("all done"))
