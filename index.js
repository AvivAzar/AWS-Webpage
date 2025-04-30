const AWS = require('aws-sdk');
const http = require('http');
const url = require('url');

AWS.config.update({
    region: 'REGION HERE',
    accessKeyId: 'ACCESS KEY ID HERE',
    secretAccessKey: 'SECRET ACCESS KEY HERE'
});

const ec2 = new AWS.EC2();
const cloudwatch = new AWS.CloudWatch();

async function getInstanceIdByIP(ipAddress) {
    const params = {
        Filters: [
            {
                Name: 'private-ip-address',
                Values: [ipAddress]
            }
        ]
    };

    try {
        const data = await ec2.describeInstances(params).promise();
        if (data.Reservations.length > 0 && data.Reservations[0].Instances.length > 0) {
            const instanceId = data.Reservations[0].Instances[0].InstanceId;
            return instanceId;
        } else {
            throw new Error('No instance found for the provided IP address.');
        }
    } catch (err) {
        console.error('Error fetching instance ID:', err);
        throw err;
    }
}

async function getCpuUsage(instanceId, period, startTime) {
    const params = {
        MetricDataQueries: [
            {
                Id: 'cpuUsage',
                MetricStat: {
                    Metric: {
                        Namespace: 'AWS/EC2',
                        MetricName: 'CPUUtilization',
                        Dimensions: [
                            {
                                Name: 'InstanceId',
                                Value: instanceId
                            }
                        ]
                    },
                    Period: 60*parseInt(period, 10), //I have converted the units to minutes since in my testing any value less than 5 minutes was rounded up to it, and only multiples of 60 seconds were accepted in this range and upwards.
                    Stat: 'Average'
                },
                ReturnData: true
            }
        ],
        StartTime: new Date(startTime).toISOString(),
        EndTime: new Date().toISOString(),
    };

    try {
        const data = await cloudwatch.getMetricData(params).promise();
        if (data.MetricDataResults && data.MetricDataResults[0]) {
            const times = data.MetricDataResults[0].Timestamps;
            const values = data.MetricDataResults[0].Values;
            if (times && values) {
                return { times, values };
            }
        } else {
            return { times: [], values: [] };
        }
    } catch (err) {
        throw new Error('Error fetching CPU usage: ' + err.message);
    }
}

// Create an HTTP server
const server = http.createServer(async (req, res) => {
    const parsedUrl = url.parse(req.url, true);

    if (req.method === 'GET' && parsedUrl.pathname === '/') {
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(`
            <html>
                <head>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                        }
                        h1 {
                            text-align: center;
                            color: #4CAF50;
                            font-size: 32px;
                            font-weight: 700;
                            margin-top: 20px;
                            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);
                        }
                        h2 {
                            font-size: 24px;
                            font-weight: bold;
                            margin-bottom: 15px;
                        }
                        form {
                            width: 70%;
                            margin: 30px auto;
                            padding: 20px;
                            border-radius: 8px;
                            box-shadow: 0 4px 8px rgba(0, 0, 0, 0.1);
                            display: flex;
                            justify-content: space-between;
                        }
                        .form-group {
                            width: 45%;
                        }
                        label {
                            font-size: 16px;
                            font-weight: bold;
                            display: block;
                            margin-bottom: 5px;
                        }
                        input[type="text"],
                        input[type="number"],
                        input[type="datetime-local"] {
                            width: 100%;
                            padding: 10px;
                            margin-bottom: 20px;
                            border-radius: 5px;
                            border: 1px solid #ddd;
                            font-size: 16px;
                        }
                        input[type="color"] {
                            width: 30px;
                            height: 30px;
                            cursor: pointer;
                        }
                        button[type="submit"] {
                            background-color: #4CAF50;
                            color: white;
                            padding: 12px 24px;
                            font-size: 16px;
                            border-radius: 5px;
                            cursor: pointer;
                            width: 100%;
                            transition: background-color 0.3s ease;
                        }
                        button[type="submit"]:hover {
                            background-color: #45a049;
                        }

                        .customization-options {
                            width: 45%;
                        }
                        .customization-options label {
                            margin-bottom: 10px;
                        }
                        .customization-options input[type="checkbox"] {
                            margin-bottom: 10px;
                        }

                        .tooltip {
                            position: relative;
                            display: inline-block;
                            cursor: pointer;
                            color: #4CAF50;
                            font-weight: normal;
                        }
                        .tooltip::after {
                            content: attr(data-tooltip);
                            position: absolute;
                            bottom: 125%; /* Position above the checkbox */
                            left: 50%;
                            transform: translateX(-50%);
                            background-color: rgba(0, 0, 0, 0.75);
                            color: #fff;
                            padding: 5px 10px;
                            border-radius: 5px;
                            font-size: 14px;
                            width: max-content;
                            max-width: 800px;
                            visibility: hidden;
                            opacity: 0;
                            transition: opacity 0.3s ease;
                        }
                        .tooltip:hover::after {
                            visibility: visible;
                            opacity: 1;
                        }
                    </style>

                </head>
                <body>
                    <h1>CPU Usage Monitor</h1>
                    <form method="POST" action="/fetch">
                        <div class="form-group">
                            <label for="ip">IP Address:</label>
                            <input type="text" id="ip" name="ip" placeholder="Enter IP address" required><br>

                            <label for="period">Sample Intervals (minutes):</label>
                            <input type="number" id="period" name="period" value="5" placeholder="Enter sample intervals (minimum 5)" required><br>

                            <label for="startTime">Start Time:</label>
                            <input type="datetime-local" id="startTime" name="startTime" required><br>

                            <button type="submit">Display CPU Usage</button>
                        </div>

                        <div class="customization-options">
                            <h2>Customization Options</h2>
                            <label for="graphColor">Choose Graph Color:</label>
                            <input type="color" id="graphColor" name="graphColor" value="#4bc0c0"><br>

                            <label class="tooltip" for="showDots" data-tooltip="Check this box to display dots on the graph for each datapoint. The dots will make it easier to see and get info about individual datapoints, but may obscure denser graphs.">Show Datapoint Dots:</label>
                            <input type="checkbox" id="showDots" name="showDots" checked><br>

                            <label class="tooltip" for="showZero" data-tooltip="Check this box to always show 0% on the y-axis, even if the data doesn't include it.">Always Show 0%:</label>
                            <input type="checkbox" id="showZero" name="showZero" checked><br>

                            <label class="tooltip" for="showHundred" data-tooltip="Check this box to always show 100% on the y-axis, even if the data doesn't include it.">Always Show 100%:</label>
                            <input type="checkbox" id="showHundred" name="showHundred"><br>
                        </div>
                    </form>
                </body>
            </html>
        `);
    } else if (req.method === 'POST' && parsedUrl.pathname === '/fetch') {
        let body = '';

        req.on('data', chunk => {
            body += chunk.toString();
        });

        req.on('end', async () => {
            const params = new URLSearchParams(body);
            const ip = params.get('ip');
            const period = params.get('period');
            const startTime = params.get('startTime');
            const graphColor = params.get('graphColor');
            const showDots = params.get('showDots') === 'on';
            const showZero = params.get('showZero') === 'on';
            const showHundred = params.get('showHundred') === 'on';

            try {
                const instanceId = await getInstanceIdByIP(ip);
                const cpuData = await getCpuUsage(instanceId, period, startTime);
                const { times, values } = cpuData;

                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(`
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
                        <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns@3"></script>
                        <script src="https://cdn.jsdelivr.net/npm/date-fns"></script>
                    </head>
                    <body>
                        <h1 style="text-align: center; color:rgb(13, 194, 119); font-size: 32px; font-weight: 700; text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.2);">CPU Usage for IP Address ${ip}</h1>
                        <h2 style="text-align: center; font-size: 24px; font-weight: normal; color: rgb(12, 116, 59);">Instance: ${instanceId}</h2>
                        <canvas id="cpuChart" width="800" height="400"></canvas>
                        <script>
                            const ctx = document.getElementById('cpuChart').getContext('2d');
                            const chart = new Chart(ctx, {
                                type: 'line',
                                data: {
                                    labels: ${JSON.stringify(times.map(time => new Date(time).toISOString()))},
                                    datasets: [{
                                        label: 'CPU Usage (%)',
                                        data: ${JSON.stringify(values)},
                                        borderColor: '${graphColor}',
                                        borderWidth: 1,
                                        fill: false,
                                        pointRadius: ${showDots ? 5 : 0}
                                    }]
                                },
                                options: {
                                    scales: {
                                        x: {
                                            type: 'time',
                                            adapters: {
                                                date: {
                                                    formats: {
                                                        datetime: 'MMM d, yyyy HH:mm:ss'
                                                    }
                                                }
                                            },
                                            time: {
                                                unit: 'minute'
                                            },
                                            title: {
                                                display: true,
                                                text: 'Time'
                                            }
                                        },
                                        y: {
                                            title: {
                                                display: true,
                                                text: 'CPU Usage (%)'
                                            },
                                            max: ${showHundred ? 100 : 'null'},
                                            min: ${showZero ? 0 : 'null'}
                                        }
                                    }
                                }
                            });
                        </script>
                    </body>
                    </html>
                `);
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end(`Error: ${err.message}`);
            }
        });
    } else {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    }
});

const PORT = 1234;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
