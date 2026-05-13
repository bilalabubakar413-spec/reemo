const { createClient } = require('@supabase/supabase-js');
require('dotenv').config({ path: '.env' });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const http = require('http');

async function simulateUpload() {
    console.log('1. Simulating Developer creation...');
    const devData = {
        naam: 'Test Robot',
        email: 'robot_' + Date.now() + '@test.com',
        type: 'ZZP',
        rol: 'Automated Tester'
    };

    const postOptions = {
        hostname: 'localhost',
        port: 3000,
        path: '/api/developers',
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(postOptions, (res) => {
        let body = '';
        res.on('data', d => body += d);
        res.on('end', async () => {
            try {
                const devJson = JSON.parse(body);
                const devId = devJson.data.developer_id;
                console.log('2. Developer created, ID:', devId);

                console.log('3. Simulating file upload to Storage...');
                const boundary = '----WebKitFormBoundary' + Math.random().toString(36).slice(2);
                const filename = 'robot_cv.pdf';
                const fileContent = 'Dummy PDF content for testing';
                
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
                    hostname: 'localhost',
                    port: 3000,
                    path: '/api/storage/upload',
                    method: 'POST',
                    headers: {
                        'Content-Type': 'multipart/form-data; boundary=' + boundary,
                        'Content-Length': Buffer.byteLength(payload)
                    }
                };

                const uploadReq = http.request(uploadOptions, (uRes) => {
                    let uBody = '';
                    uRes.on('data', d => uBody += d);
                    uRes.on('end', async () => {
                        try {
                            const uploadJson = JSON.parse(uBody);
                            console.log('4. Upload Result:', uploadJson);

                            if (uploadJson.ok) {
                                console.log('5. Verifying DB state...');
                                const { data: dbCheck } = await supabase
                                    .from('developer')
                                    .select('developer_id, naam, cv_url')
                                    .eq('developer_id', devId)
                                    .single();
                                
                                console.log('DB Result:', dbCheck);
                                
                                console.log('6. Verifying Storage file existence...');
                                const { data: files } = await supabase.storage.from('cvs').list();
                                const exists = files && files.some(f => f.name === uploadJson.data.filePath);
                                console.log('File in storage:', exists ? 'YES (' + uploadJson.data.filePath + ')' : 'NO');
                                
                                if (exists && dbCheck.cv_url) {
                                    console.log('SUCCESS: CV upload flow verified.');
                                    process.exit(0);
                                } else {
                                    console.error('FAILURE: Missing data in DB or Storage.');
                                    process.exit(1);
                                }
                            } else {
                                console.error('Upload failed:', uploadJson.error);
                                process.exit(1);
                            }
                        } catch (e) { console.error('JSON parse error (upload):', e); process.exit(1); }
                    });
                });
                uploadReq.write(payload);
                uploadReq.end();
            } catch (e) { console.error('JSON parse error (dev):', e); process.exit(1); }
        });
    });
    req.write(JSON.stringify(devData));
    req.end();
}

simulateUpload();
