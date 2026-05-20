const video = document.getElementById('video');
const captureButton = document.getElementById('capture');
const recordStartButton = document.getElementById('record-start');
const recordStopButton = document.getElementById('record-stop');
const clearGalleryButton = document.getElementById('clear-gallery');
const canvas = document.getElementById('canvas');
const captureCanvas = document.createElement('canvas');
const gallery = document.getElementById('gallery');
const status = document.getElementById('status');
let currentFilter = 'none';
let mediaRecorder = null;
let recordedChunks = [];
let currentStream = null;

const filterMap = {
    none: 'none',
    brightness: 'brightness(1.35)',
    contrast: 'contrast(1.5)',
    blur: 'blur(4px)',
    sepia: 'sepia(0.9)',
    grayscale: 'grayscale(1)',
    'hue-rotate': 'hue-rotate(120deg)',
    saturate: 'saturate(1.8)',
    invert: 'invert(1)',
    warm: 'sepia(0.25) saturate(1.25)',
    cool: 'hue-rotate(190deg) saturate(1.1)',
    vintage: 'contrast(1.1) sepia(0.4) saturate(1.1)',
};

const filterButtons = document.querySelectorAll('.filter-btn');
let recordingCanvas = canvas;
let recordingStream = null;
let animationFrameId = null;

filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        video.style.filter = filterMap[currentFilter] || 'none';
        filterButtons.forEach(other => other.classList.toggle('active', other === btn));
    });
});

function drawVideoToCanvas() {
    if (!video.videoWidth || !video.videoHeight) {
        animationFrameId = requestAnimationFrame(drawVideoToCanvas);
        return;
    }

    if (recordingCanvas.width !== video.videoWidth || recordingCanvas.height !== video.videoHeight) {
        recordingCanvas.width = video.videoWidth;
        recordingCanvas.height = video.videoHeight;
    }

    const context = recordingCanvas.getContext('2d');
    context.filter = filterMap[currentFilter] || 'none';
    context.drawImage(video, 0, 0, recordingCanvas.width, recordingCanvas.height);
    animationFrameId = requestAnimationFrame(drawVideoToCanvas);
}

async function startCamera() {
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 3840 },
                height: { ideal: 2160 },
                frameRate: { ideal: 60 },
                aspectRatio: { ideal: 16 / 9 },
                facingMode: 'user',
            },
            audio: true,
        });

        currentStream = stream;
        video.srcObject = stream;
        await video.play();

        const trackSettings = stream.getVideoTracks()[0].getSettings();
        const width = trackSettings.width || video.videoWidth || 1920;
        const height = trackSettings.height || video.videoHeight || 1080;

        recordingCanvas.width = width;
        recordingCanvas.height = height;
        captureCanvas.width = width;
        captureCanvas.height = height;

        status.textContent = 'Camera active. Choose a filter, take a picture, or record.';
        drawVideoToCanvas();
    } catch (err) {
        status.textContent = 'Unable to access camera. Please allow permission.';
        console.error('Error accessing camera', err);
    }
}

function createSaveButton(url, filename, label = 'Save') {
    const btn = document.createElement('button');
    btn.textContent = label;
    btn.className = 'save-btn';
    btn.addEventListener('click', async () => {
        await saveFile(url, filename);
    });
    return btn;
}

async function saveFile(url, filename) {
    if (window.showSaveFilePicker) {
        try {
            const fileHandle = await window.showSaveFilePicker({
                suggestedName: filename,
                types: [{ description: 'Media file', accept: { 'image/png': ['.png'], 'video/webm': ['.webm'] } }],
            });
            const writable = await fileHandle.createWritable();
            const response = await fetch(url);
            const blob = await response.blob();
            await writable.write(blob);
            await writable.close();
            status.textContent = `${filename} saved successfully.`;
            return;
        } catch (err) {
            console.warn('File save cancelled or failed:', err);
        }
    }

    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    status.textContent = `Download started for ${filename}.`;
}

function createGalleryItem(type, mediaElement, downloadUrl, filename) {
    const card = document.createElement('div');
    card.className = 'gallery-item';

    const label = document.createElement('div');
    label.className = 'media-label';
    label.textContent = type === 'photo' ? 'Photo' : 'Video';

    const saveButton = createSaveButton(downloadUrl, filename);
    const removeButton = document.createElement('button');
    removeButton.textContent = 'Remove';
    removeButton.className = 'remove-btn';
    removeButton.addEventListener('click', () => card.remove());

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(saveButton, removeButton);

    card.append(label, mediaElement, actions);
    gallery.prepend(card);
}

function capturePhoto() {
    if (!currentStream) {
        status.textContent = 'Camera not ready yet.';
        return;
    }
    if (!video.videoWidth || !video.videoHeight) {
        status.textContent = 'Preparing capture... Please wait a moment.';
        return;
    }

    const context = captureCanvas.getContext('2d');
    // Use video's intrinsic resolution for highest quality capture
    captureCanvas.width = video.videoWidth;
    captureCanvas.height = video.videoHeight;
    context.filter = filterMap[currentFilter] || 'none';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    captureCanvas.toBlob(blob => {
        if (!blob) {
            status.textContent = 'Failed to capture photo.';
            return;
        }

        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Captured photo';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        createGalleryItem('photo', img, url, `mirror-photo-${timestamp}.png`);
        status.textContent = 'Photo captured and ready to save.';
    }, 'image/png');
}

    const context = captureCanvas.getContext('2d');
    // Set canvas to full video resolution for high quality capture
    captureCanvas.width = recordingCanvas.width;
    captureCanvas.height = recordingCanvas.height;
    context.filter = filterMap[currentFilter] || 'none';
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high'; // High quality scaling if needed
    context.drawImage(video, 0, 0, captureCanvas.width, captureCanvas.height);

    captureCanvas.toBlob(blob => {
        if (!blob) {
            status.textContent = 'Failed to capture photo.';
            return;
        }

        const url = URL.createObjectURL(blob);
        const img = document.createElement('img');
        img.src = url;
        img.alt = 'Captured photo';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        createGalleryItem('photo', img, url, `mirror-photo-${timestamp}.png`);
        status.textContent = 'Photo captured and ready to save.';
    }, 'image/png');
}

function startRecording() {
    if (!currentStream) {
        status.textContent = 'Camera not ready yet.';
        return;
    }

    recordedChunks = [];
    const canvasStream = recordingCanvas.captureStream(60);
    const audioTracks = currentStream.getAudioTracks();
    const combinedStream = new MediaStream([...canvasStream.getVideoTracks(), ...audioTracks]);
    recordingStream = combinedStream;

    const options = {
        mimeType: MediaRecorder.isTypeSupported('video/webm; codecs=vp9') ? 'video/webm; codecs=vp9' : 'video/webm; codecs=vp8',
        videoBitsPerSecond: 8000000,
    };
    mediaRecorder = new MediaRecorder(recordingStream, options);

    mediaRecorder.addEventListener('dataavailable', event => {
        if (event.data && event.data.size > 0) {
            recordedChunks.push(event.data);
        }
    });

    mediaRecorder.addEventListener('stop', () => {
        const blob = new Blob(recordedChunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        const videoPreview = document.createElement('video');
        videoPreview.controls = true;
        videoPreview.src = url;
        videoPreview.className = 'gallery-video';

        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        createGalleryItem('video', videoPreview, url, `mirror-video-${timestamp}.webm`);
        status.textContent = 'Video recording saved to gallery. Use Save to export it.';
    });

    mediaRecorder.start();
    recordStartButton.disabled = true;
    recordStopButton.disabled = false;
    status.textContent = 'Recording... Click stop when finished.';
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    recordStartButton.disabled = false;
    recordStopButton.disabled = true;
}

function clearGallery() {
    gallery.innerHTML = '';
    status.textContent = 'Gallery cleared.';
}

captureButton.addEventListener('click', capturePhoto);
recordStartButton.addEventListener('click', startRecording);
recordStopButton.addEventListener('click', stopRecording);
clearGalleryButton.addEventListener('click', clearGallery);

startCamera();