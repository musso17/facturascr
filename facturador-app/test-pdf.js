const pdfParseModule = require('pdf-parse');
async function test() {
    let fn = typeof pdfParseModule === 'function' ? pdfParseModule : (pdfParseModule.default || pdfParseModule.PDFParse);
    try {
        let pdf = await fn(Buffer.from(''));
        console.log("Success with fn", pdf.text);
    } catch(e) {
        console.log("Error with fn:", e.message);
    }
}
test();
