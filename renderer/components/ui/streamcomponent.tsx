import React from 'react'
import Button from './button'
import type xPlayer from 'xbox-xcloud-player'
import Loader from './loader'
import Card from './card'
import uPlot from 'uplot'
import Ipc from '../../lib/ipc'

// Define interface for buffer parameters
interface BufferParams {
    jitterBufferMinimumDelay: number;
    jitterBufferTargetDelay: number;
}

interface StreamComponentProps {
  onDisconnect?: () => void;
  onMenu?: () => void;
  xPlayer: xPlayer;
}

function StreamComponent({
    onDisconnect,
    onMenu,
    xPlayer,
}: StreamComponentProps) {

    function performance_now_seconds() {
        return performance.now() / 1000.0
    }

    // This function is now called from the Stream component
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function optimizeWebRTCSettings(player) {
        // Get RTCPeerConnection to adjust buffer settings
        if (player && player._webrtcClient && player._webrtcClient._peerConnection) {
            const pc = player._webrtcClient._peerConnection
            
            // Set optimal jitter buffer delays based on platform
            try {
                // Reduce jitter buffer delay to improve responsiveness
                const params: BufferParams = {
                    jitterBufferMinimumDelay: 0.2, // Default 200ms minimum delay
                    jitterBufferTargetDelay: 0.3  // Default 300ms target delay
                }
                
                if (navigator.userAgent.includes('Mac')) {
                    // Optimized for macOS, especially M1/M2
                    params.jitterBufferMinimumDelay = 0.1 // 100ms minimum delay
                    params.jitterBufferTargetDelay = 0.2 // 200ms target delay
                }
                
                // Apply settings to each receiver
                pc.getReceivers().forEach(receiver => {
                    if (receiver.track.kind === 'video' && typeof receiver.jitterBufferDelayHint !== 'undefined') {
                        console.log('Setting jitter buffer delay hint to:', params.jitterBufferTargetDelay)
                        receiver.jitterBufferDelayHint = params.jitterBufferTargetDelay
                    }
                    
                    // If parameters can be modified, set them directly
                    if (receiver.setParameters && receiver.getParameters) {
                        const parameters = receiver.getParameters()
                        if (parameters.jitterBufferMinimumDelay !== undefined) {
                            parameters.jitterBufferMinimumDelay = params.jitterBufferMinimumDelay
                            parameters.jitterBufferTargetDelay = params.jitterBufferTargetDelay
                            receiver.setParameters(parameters)
                        }
                    }
                })
                
                console.log('WebRTC optimization complete')
            } catch (error) {
                console.error('Error optimizing WebRTC parameters:', error)
            }
        }
    }

    let lastMovement = 0
    let debugElement = document.getElementById('component_streamcomponent_debug')
    let webRtcStatsInterval

    const [micStatus, setMicStatus] = React.useState(false)
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const [waitingSeconds, setWaitingSeconds] = React.useState(0)

    let jitterData = [new Float32Array([performance_now_seconds()]), new Float32Array([0.0])]
    let droppedData = [new Float32Array([performance_now_seconds()]), new Float32Array([0.0]), new Float32Array([0.0])]
    let framesDroppedBaseline = 0
    let packetsDroppedBaseline = 0
    let frameCountDomUpdate = 0


    function sliceData(data, start, end) {
        const d = []

        for (let i = 0; i < data.length; i++)
            d.push(data[i].slice(start, end))

        return d
    }

    React.useEffect(() => {
        Ipc.onAction('streaming', 'onQueue', (event, waitingTimes) => {
            console.log('Waiting times:', waitingTimes)
            drawWaitingTimes(waitingTimes.estimatedTotalWaitTimeInSeconds)
        })

        const jitterUplot = new uPlot({
            title: 'Jitter (ms)',
            id: 'component_streamcomponent_debug_webrtc_jitter',
            class: 'debug-chart',
            width: 600,
            height: 230,
            scales: {
                'x': {
                    time: false,
                },
            },
            series: [
                {},
                {
                    show: true,
                    spanGaps: false,
                    label: 'Jitter',
                    stroke: 'red',
                    width: 2,
                    fill: 'rgba(255, 0, 0, 0.3)',
                },
            ],
            axes: [
                {
                    values: (u, vals) => vals.map(v => +v),
                },
                {
                    size: 50,
                    stroke: 'red',
                    values: (u, vals) => vals.map(v => (+v*1000.0).toFixed(1)),
                },
            ],
        }, jitterData, document.getElementById('component_streamcomponent_debug_webrtc_jitter'))

        const droppedUplot = new uPlot({
            title: 'Packets lost / Frames dropped',
            id: 'component_streamcomponent_debug_webrtc_dropped',
            class: 'debug-chart',
            width: 600,
            height: 230,
            scales: {
                'x': {
                    time: false,
                },
            },
            series: [
                {},
                {
                    show: true,
                    spanGaps: false,
                    label: 'Packets lost',
                    stroke: 'green',
                    width: 2,
                    fill: 'rgba(0, 255, 0, 0.3)',
                },
                {
                    show: true,
                    spanGaps: false,
                    label: 'Frames dropped',
                    stroke: 'blue',
                    width: 2,
                    fill: 'rgba(0, 0, 255, 0.3)',
                },
            ],
            axes: [
                {
                    values: (u, vals) => vals.map(v => +v),
                },
                {
                    size: 50,
                    stroke: 'green',
                    values: (u, vals) => vals.map(v => +v.toFixed(0)),
                    grid: {show: false},
                },
                {
                    side: 1,
                    stroke: 'blue',
                    values: (u, vals) => vals.map(v => +v.toFixed(0)),
                    grid: {show: false},
                },
            ],
        }, droppedData, document.getElementById('component_streamcomponent_debug_webrtc_dropped'))

        webRtcStatsInterval = setInterval(() => {
            if(xPlayer._webrtcClient !== undefined){
                xPlayer._webrtcClient.getStats().then((stats) => {
                    let statsOutput = ''

                    stats.forEach((report) => {
                        if (report.type === 'inbound-rtp' && report.kind === 'video') {

                            if(jitterData[0].length > 1200){
                                jitterData = sliceData(jitterData, jitterData[0].length-1200, jitterData[0].length)
                            }
                            if(droppedData[0].length > 1200){
                                droppedData = sliceData(droppedData, droppedData[0].length-1200, droppedData[0].length)
                            }

                            jitterData[0] = new Float32Array([...Array.from(jitterData[0]), performance_now_seconds()])
                            jitterData[1] = new Float32Array([...Array.from(jitterData[1]), report['jitter']])

                            droppedData[0] = new Float32Array([...Array.from(droppedData[0]), performance_now_seconds()])
                            droppedData[1] = new Float32Array([...Array.from(droppedData[1]), report['packetsLost']-packetsDroppedBaseline])
                            droppedData[2] = new Float32Array([...Array.from(droppedData[2]), report['framesDropped']-framesDroppedBaseline])
                            packetsDroppedBaseline = report['packetsLost']
                            framesDroppedBaseline = report['framesDropped']

                            jitterUplot.setData(jitterData)
                            droppedUplot.setData(droppedData)

                            if(frameCountDomUpdate >= 15){
                                Object.keys(report).forEach((statName) => {
                                    statsOutput += `<strong>${statName}:</strong> ${report[statName]}<br>\n`
                                })
                                document.querySelector('div#component_streamcomponent_debug_text').innerHTML = statsOutput
                                frameCountDomUpdate = 0
                            } else {
                                frameCountDomUpdate++
                            }
                        }
                    })
                })
            }
        }, 33)

        // Gamebar menu mouse events
        const mouseEvent = () => {
            lastMovement = Date.now()
        }
        window.addEventListener('mousemove', mouseEvent)
        window.addEventListener('mousedown', mouseEvent)

        const mouseInterval = setInterval(() => {
            const gamebarElement = document.getElementById('component_streamcomponent_gamebar')
            if(gamebarElement === null){
                return
            }

            if((Date.now()-lastMovement) >= 2000){
                if(! gamebarElement.className.includes('hidden')){
                    gamebarElement.className = 'hidden'
                }

            } else {
                if(gamebarElement.className.includes('hidden')){
                    gamebarElement.className = ''
                }
            }
        }, 100)

        // Keyboard events
        const keyboardPressEvent = (e) => {
            switch(e.keyCode){
                case 126:
                    toggleDebug()
                    break
            }
        }
        window.addEventListener('keypress', keyboardPressEvent)

        // Apply initial optimizations for this component
        const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0
        const isM1 = isMac && navigator.userAgent.indexOf('AppleWebKit') >= 0
        
        if (isMac && isM1) {
            // Attempt to optimize debug display for better performance
            const debugElement = document.getElementById('component_streamcomponent_debug')
            if (debugElement) {
                debugElement.className = 'hidden'
            }
        }

        // cleanup this component
        return () => {
            window.removeEventListener('mousemove', mouseEvent)
            window.removeEventListener('mousedown', mouseEvent)
            window.removeEventListener('keypress', keyboardPressEvent)
            clearInterval(mouseInterval)

            if(webRtcStatsInterval){
                clearInterval(webRtcStatsInterval) 
            }
            if(document.getElementById('component_streamcomponent_debug_webrtc_jitter') !== null) {
                document.getElementById('component_streamcomponent_debug_webrtc_jitter').innerHTML = ''
            }
            if(document.getElementById('component_streamcomponent_debug_webrtc_dropped') !== null) {
                document.getElementById('component_streamcomponent_debug_webrtc_dropped').innerHTML = ''
            }
        }
    }, [])

    function toggleMic(){
        if(xPlayer.getChannelProcessor('chat').isPaused === true){
            xPlayer.getChannelProcessor('chat').startMic()
            setMicStatus(true)
        } else {
            xPlayer.getChannelProcessor('chat').stopMic()
            setMicStatus(false)
        }
    }

    function streamDisconnect(){
        document.getElementById('streamComponentHolder').innerHTML = ''
        xPlayer.close()
    }

    function endStream(){
        if(confirm('Are you sure you want to end your stream?')){
            document.getElementById('streamComponentHolder').innerHTML = ''
            onDisconnect()
            xPlayer.close()
        }
    }

    function toggleDebug(){
        if(debugElement === null){
            debugElement = document.getElementById('component_streamcomponent_debug')
        }

        if(debugElement.className.includes('hidden')){
            debugElement.className = ''
        } else {
            debugElement.className = 'hidden'
        }
    }

    function drawWaitingTimes(seconds){
        if(seconds !== false){
            setWaitingSeconds(seconds)

            const formattedWaitingTime = formatWaitingTime(seconds)
            const html = '<div>Estimated waiting time in queue: <span id="component_streamcomponent_waitingtimes_seconds">'+formattedWaitingTime+'</span></div>'

            document.getElementById('component_streamcomponent_waitingtimes').innerHTML = html

            const secondsInterval = setInterval(() => {
                seconds--
                setWaitingSeconds(seconds)

                if(document.getElementById('component_streamcomponent_waitingtimes') !== null){
                    document.getElementById('component_streamcomponent_waitingtimes_seconds').innerText = formatWaitingTime(seconds)
                } else {
                    clearInterval(secondsInterval)
                }

                if(seconds === 0){
                    clearInterval(secondsInterval)
                }
            }, 1000)
        }
    }

    function formatWaitingTime(rawSeconds: number): string {
        let formattedText = ''

        const hours = Math.floor(rawSeconds / 3600)
        const minutes = Math.floor((rawSeconds % 3600) / 60)
        const seconds = (rawSeconds % 3600) % 60

        if (hours > 0) {
            formattedText += hours + ' hour(s), '
        }

        if (minutes > 0) {
            formattedText += minutes + ' minute(s), '
        }

        if (seconds > 0) {
            formattedText += seconds + ' second(s).'
        }

        return formattedText
    }

    return (
        <React.Fragment>
            <div>
                <div id="streamComponentHolder">
                </div>

                <div id="component_streamcomponent_loader">
                    <Card className='padbottom'>
                        <h1>Loading...</h1>

                        <Loader></Loader>

                        <p>We are getting your stream ready...</p>
                        <p id="component_streamcomponent_connectionstatus"></p>

                        <p id="component_streamcomponent_waitingtimes"></p>
                    </Card>
                </div>

                <div id="component_streamcomponent_gamebar">
                    <div id="component_streamcomponent_gamebar_menu">
                        <div style={{
                            width: '25%',
                        }}>
                            <Button label={<span><i className="fa-solid fa-xmark"></i> End Stream</span>} title="End Stream" className='btn-cancel' onClick={ () => {
                                endStream() 
                            } }></Button> &nbsp;
                            <Button label={<span><i className="fa-solid fa-xmark"></i></span>} title="Disconnect" className='btn' onClick={ () => {
                                streamDisconnect() 
                            } }></Button>
                        </div>

                        <div style={{
                            marginLeft: 'auto',
                            marginRight: 'auto',
                        }}>
                            <Button label={ <span><i className="fa-brands fa-xbox"></i> Menu</span> } title="Open Xbox menu" onClick={ (e) => {
                                e.target.blur(); onMenu() 
                            }}></Button> &nbsp;
                            <Button label={ (micStatus === false) ? <span><i className="fa-solid fa-microphone-slash"></i> Muted</span> : <span><i className="fa-solid fa-microphone"></i> Active</span> } title={ (micStatus === false) ? 'Enable mic' : 'Disable mic' } className={ (micStatus === false) ? 'btn-cancel' : 'btn-primary' } onClick={ (e) => {
                                e.target.blur(); toggleMic() 
                            }}></Button>
                        </div>

                        <div style={{
                            marginRight: 20,
                            width: '25%',
                            textAlign: 'right',
                        }}>
                            <Button label={ <i className="fa-solid fa-bug"></i> } title="Debug" onClick={ (e) => {
                                e.target.blur(); toggleDebug() 
                            } }></Button>
                        </div>
                    </div>
                </div>

                <div id="component_streamcomponent_debug" className='hidden'>
                    <p>Debug:</p>

                    <div id="component_streamcomponent_debug_webrtc_jitter"></div>
                    <div id="component_streamcomponent_debug_webrtc_dropped"></div>

                    <div id="component_streamcomponent_debug_text"></div>
                </div>
            </div>
        </React.Fragment>
    )
}

export default StreamComponent