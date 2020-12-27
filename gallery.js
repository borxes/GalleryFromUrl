const fs = require('fs')
const fsPromises = require('fs').promises
const path = require('path')
const url = require('url')
const axios = require('axios')
const sharp = require('sharp')

const LOCAL_FILE = 'temp.html'
const GALLERY_FILE = 'index.html'
const WIDTH = 120


function parse_cmd() {
  if (process.argv.length !== 4) return {}
  else return {
    targetUrl: process.argv[2],
    folder: process.argv[3],
  }
}

function quit(err) {
  console.log(err)
  process.exit(1)
}

async function downloadFile(targetUrl, localFileName) {
  console.log(`[downloading] ${targetUrl} to ${localFileName}`)
  const writer = fs.createWriteStream(localFileName)

  const response = await axios({
    url: targetUrl,
    method: 'GET',
    responseType: 'stream'
  })

  response.data.pipe(writer)

  return new Promise((resolve, reject) => {
    writer.on('finish', resolve)
    writer.on('error', err => {
      writer.close();
      reject(err)
    })
  })
}

async function readFile(fileName) {
  const data = await fsPromises.readFile(fileName)
  return data.toString('utf8')
}

// returns urls of all images in given html string
function getImages(string) {
  const imgRex = /<img.*?src="(.*?)"[^>]+>/g
  const images = []
  let img
  while ((img = imgRex.exec(string))) {
    images.push(img[1])
  }
  return images
}

// normalized image URL to full
function getFullImageUrl(targetUrl, imageUrl) {
  return (new url.URL(imageUrl, targetUrl)).toString()
}

// returns the name portion of the image in imageUrl
function getImageName(imageUrl) {
  const pathName = new url.URL(imageUrl).pathname
  const lastSlashIndex = pathName.lastIndexOf('/')
  return lastSlashIndex > -1 ? pathName.slice(lastSlashIndex + 1) : pathName
}

// downloads all images from the given list to the localFolder
async function downloadImages(images, localFolder, pathToURLMap) {
  return Promise.all(images.map((image, i) => {
    const localPath = path.resolve(`${__dirname}/${localFolder}`, `${i}.${getImageName(image)}`);
    pathToURLMap.push({ url: image, path: localPath })
    return downloadFile(image, path.resolve(`${__dirname}/${localFolder}`, `${i}.${getImageName(image)}`))
  }
  ))
}

// resizes a given image to fixed width
async function resizeImage(imagePath) {
  let buffer = undefined
  try {
    buffer = await sharp(imagePath).resize({ width: WIDTH }).toBuffer()
  } catch (err) {
    console.log(`[resizeImage] couldn't resize ${imagePath}`)
  }
  return buffer
}


// finds image url in pathToUrl object given image path 
function findImageUrl(resizedImage, pathToUrl) {
  const resizeStrIndex = resizedImage.indexOf('.resized.')
  const origUrl = resizedImage.slice(0, resizeStrIndex) + resizedImage.slice(resizeStrIndex + '.resized.'.length - 1)
  const found = pathToUrl.find(elem => elem.path === origUrl)
  console.log(`[findImage] path ${resizedImage} orig ${origUrl} found ${found} the whole map ${JSON.stringify(pathToUrl)}`)
  return found ? found.url : ''
}

// resizes all images in the given folder
// image.png => image.resized.png
async function resizeImages(localFolder, pathToUrl) {
  const allResized = []
  const files = fs.readdirSync(localFolder);
  for (let i = 0; i < files.length; i++) {
    const imagePath = path.resolve(localFolder, files[i])
    const lastDotIndex = imagePath.lastIndexOf('.')
    const resizedPath = lastDotIndex > -1
      ? imagePath.slice(0, lastDotIndex) + '.resized' + imagePath.slice(lastDotIndex)
      : imagePath + 'resized'
    console.log(`trying to resize ${imagePath}`)
    const resized = await resizeImage(imagePath)
    if (resized) {
      await fsPromises.writeFile(resizedPath, resized)
      const metadata = await sharp(imagePath).metadata()
      allResized.push({ resizedPath, metadata, url: findImageUrl(resizedPath, pathToUrl) })
    }
  }
  return allResized
}


// build the gallery html file
async function createGallery(folder, resizedImages) {
  const writer = fs.createWriteStream(path.resolve(folder, GALLERY_FILE), { flags: 'w' })
  writer.write(`
    <html>
      <body>
        <style type="text/css"> 
          .box {display: flex; flex-flow: column; align-items: center}
          .item {display: flex; flex-flow: column; align-items: center; margin: 2em auto 2em}
          img { margin-bottom: 1em}
        </style>
    `)
  writer.write('<div class="box">')
  for (let i = 0; i < resizedImages.length; i++) {
    const image = resizedImages[i]
    const div = `
      <div class="item">
        <img src='${image.resizedPath}' />
        URL: ${image.url} Original size: ${image.metadata.width} x ${image.metadata.height} Format: ${image.metadata.format}
      </div >\n
      `
    writer.write(div)
  }
  writer.write('</div></body></html > ')
}


async function main() {

  const { targetUrl, folder } = parse_cmd()

  if (!targetUrl || !folder) quit('Usage: node gallery[URL][output_folder] ')

  try {
    await downloadFile(targetUrl, path.resolve(__dirname, LOCAL_FILE))
  } catch (err) {
    quit(`Error downloading file at ${targetUrl}: ${err}`)
  }

  const outputFolder = path.join(__dirname, folder)

  try {
    if (!fs.existsSync(outputFolder)) {
      console.log(`Folder ${folder} doesn't exist. Creating...`)
      fs.mkdirSync(outputFolder)
    }
  } catch (err) { quit(`Error creating output folder: ${err}`) }

  try {
    const html = await readFile(LOCAL_FILE)
    const images = getImages(html).map(img => getFullImageUrl(targetUrl, img))
    const pathToUrl = []
    await downloadImages(images, folder, pathToUrl)
    const resized = await resizeImages(outputFolder, pathToUrl)
    await createGallery(folder, resized)
  } catch (err) {
    quit(`Error reading downloaded file: ${err}`)
  }
}

main()