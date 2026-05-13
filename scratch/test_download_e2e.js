const { createClient } = require('./backend/node_modules/@supabase/supabase-js');
require('./backend/node_modules/dotenv').config({ path: 'backend/.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const http = require('http');

async function simulateRealUpload() {
    console.log('1. Creating Developer...');
    const devData = { naam: 'Download Test', email: 'dl_test_' + Date.now() + '@test.com' };
    
    const postOptions = {
        hostname: 'localhost', port: 3000, path: '/api/developers', method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(postOptions, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', async () => {
            const devJson = JSON.parse(body);
            const devId = devJson.data.developer_id;
            console.log('2. Developer ID:', devId);

            console.log('3. Uploading REAL buffer...');
            const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
            const filename = 'real_test.pdf';
            const fileContent = 'THIS IS A REAL PDF CONTENT FOR TESTING DOWNLOADS';
            
            let data = [];
            data.push('--' + boundary + '\r\n');
            data.push('Content-Disposition: form-data; name="bucket"\r\n\r\n' + 'cvs' + '\r\n');
            data.push('--' + boundary + '\r\n');
            data.push('Content-Disposition: form-data; name="developer_id"\r\n\r\n' + devId + '\r\n');
            data.push('--' + boundary + '\r\n');
            data.push('Content-Disposition: form-data; name="file"; filename="' + filename + '"\r\n');
            data.push('Content-Type: application/pdf\r\n\r\n');
            data.push(fileContent + '\r\n');
            data.push('--' + boundary + '--\r\n');

            const payload = data.join('');

            const uploadOptions = {
                hostname: 'localhost', port: 3000, path: '/api/storage/upload', method: 'POST',
                headers: {
                    'Content-Type': 'multipart/form-data; boundary=' + boundary,
                    'Content-Length': Buffer.byteLength(payload)
                }
            };

            const uploadReq = http.request(uploadOptions, (uRes) => {
                let uBody = '';
                uRes.on('data', d => uBody += d);
                uRes.on('end', async () => {
                    const uploadJson = JSON.parse(uBody);
                    console.log('4. Upload Result:', uploadJson);

                    console.log('5. Fetching Signed URL...');
                    http.get('http://localhost:3000/api/developers/' + devId + '/cv-url', (urlRes) => {
                        let urlBody = '';
                        urlRes.on('data', d => urlBody += d);
                        urlRes.on('end', async () => {
                            const urlJson = JSON.parse(urlBody);
                            console.log('6. URL Result:', urlJson);
                            
                            const signedUrl = urlJson.data.url;
                            const hasDownloadParam = signedUrl.includes('download=CV_Download_Test.pdf');
                            console.log('7. Download Param present:', hasDownloadParam ? 'YES' : 'NO');
                            
                            const { data: fileInfo } = await supabase.storage.from('cvs').list();
                            const actualFile = fileInfo.find(f => f.name === uploadJson.data.filePath);
                            console.log('8. Storage File Size:', actualFile?.metadata?.size, 'bytes');

                            process.exit(hasDownloadParam && actualFile?.metadata?.size > 10 ? 0 : 1);
                        });
                    });
                });
            });
            uploadReq.write(payload);
            uploadReq.end();
        });
    });
    req.write(JSON.stringify(devData));
    req.end();
}
simulateRealUpload();
