const video = document.getElementById("video");
const captureButton = document.getElementById('capture');
const canvas = document.getElementById('canvas');
const gallery = document.getElementById('gallery');
let currentFilter = 'none';

const filterButtons = document.querySelectorAll('.filter-btn');
filterButtons.forEach(btn => {
    btn.addEventListener('click', () => {
        currentFilter = btn.dataset.filter;
        // Apply filter to video in real-time
        video.className = '';
        if (currentFilter !== 'none') {
            video.classList.add(currentFilter);
        }
    });
});

navigator.mediaDevices.getUserMedia({ video: true })
    .then(stream => {
        video.srcObject = stream;
    })
    .catch(err => {
        console.error("Error accessing camera", err);
    });

captureButton.addEventListener('click', () => {
    const context = canvas.getContext('2d');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    context.drawImage(video, 0, 0);
    const dataUrl = canvas.toDataURL('image/png');
    const img = document.createElement('img');
    img.src = dataUrl;
    if (currentFilter !== 'none') {
        img.classList.add(currentFilter);
    }
    gallery.appendChild(img);
});