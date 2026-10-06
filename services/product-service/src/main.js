// Placeholder HTTP server: có /healthz để Deployment probe chạy được.
// Thay toàn bộ thư mục src bằng code NestJS thật.
const http = require('http');
const name = 'product-service';
const port = process.env.PORT || 3002;

http
  .createServer((req, res) => {
    if (req.url === '/healthz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ status: 'ok', service: name }));
    }
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(name + ' placeholder\n');
  })
  .listen(port, () => console.log(name + ' listening on ' + port));
