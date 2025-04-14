// auth.js
import { showLoginRegistration, hideLoginRegistration, displayAuthError, clearAuthError } from './auth_ui.js';

export function setupAuth(socket, onAuthSuccess) {
    const loginForm = document.getElementById('login-form');
    const registerForm = document.getElementById('register-form');

    loginForm.addEventListener('submit', (e) => {
        e.preventDefault();
        clearAuthError();
        const username = loginForm.username.value;
        const password = loginForm.password.value;
        socket.emit('login', { username, password }, (response) => {
            if (response.success) {
                //  Handle successful login (e.g., store token)
                hideLoginRegistration();
                onAuthSuccess(response.userId); //  Callback to handle game start
            } else {
                displayAuthError(response.error);
            }
        });
    });

    registerForm.addEventListener('submit', (e) => {
        e.preventDefault();
        clearAuthError();
        const username = registerForm.username.value;
        const password = registerForm.password.value;
        socket.emit('register', { username, password }, (response) => {
            if (response.success) {
                // Handle successful registration
                displayAuthError('Registration successful. You can now log in.');
                showLoginRegistration(); // Optionally, show login form after registration
            } else {
                displayAuthError(response.error);
            }
        });
    });

    showLoginRegistration(); // Show auth forms on initial load
}