// auth_ui.js

export function showLoginRegistration() {
    //  Display login/registration forms
    document.getElementById('auth-form').style.display = 'flex';
    document.getElementById('game-canvas').style.display = 'none';
    document.getElementById('status').style.display = 'none';
}

export function hideLoginRegistration() {
    //  Hide login/registration forms
    document.getElementById('auth-form').style.display = 'none';
    document.getElementById('game-canvas').style.display = 'block';
    document.getElementById('status').style.display = 'block';
}

export function displayAuthError(message) {
    // Display error message to the user
    const errorElement = document.getElementById('auth-error');
    if (errorElement) {
        errorElement.textContent = message;
        errorElement.style.color = 'red';
    }
}

export function clearAuthError() {
    const errorElement = document.getElementById('auth-error');
    if (errorElement) {
        errorElement.textContent = '';
    }
}