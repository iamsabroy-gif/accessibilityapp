const puppeteer = require('puppeteer');
const fs = require('fs');

(async () => {
    // Read HTML from stdin
    const html = fs.readFileSync(0, 'utf-8');

    if (!html) {
        console.error('No HTML provided on stdin');
        process.exit(1);
    }

    const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    try {
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            margin: { top: '20mm', right: '20mm', bottom: '20mm', left: '20mm' },
            printBackground: true
        });

        // Write PDF bytes to stdout
        process.stdout.write(pdfBuffer);
    } catch (err) {
        console.error('Error generating PDF:', err);
        process.exit(1);
    } finally {
        await browser.close();
    }
})();
