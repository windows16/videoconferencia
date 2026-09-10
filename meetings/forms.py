from django import forms
from django.contrib.auth.models import User
from .models import Meeting
import datetime

class LoginForm(forms.Form):
    email = forms.EmailField(
        widget=forms.EmailInput(attrs={
            'class': 'form-control-meet',
            'placeholder': 'correo@ejemplo.com',
            'autocomplete': 'email',
            'required': 'true'
        }),
        label='Correo Electrónico'
    )
    password = forms.CharField(
        widget=forms.PasswordInput(attrs={
            'class': 'form-control-meet',
            'placeholder': 'Introduce tu contraseña',
            'autocomplete': 'current-password',
            'required': 'true'
        }),
        label='Contraseña'
    )

class RegisterForm(forms.ModelForm):
    first_name = forms.CharField(
        max_length=50,
        required=True,
        widget=forms.TextInput(attrs={'class': 'form-control-meet', 'placeholder': 'Nombre'})
    )
    last_name = forms.CharField(
        max_length=50,
        required=True,
        widget=forms.TextInput(attrs={'class': 'form-control-meet', 'placeholder': 'Apellidos'})
    )
    email = forms.EmailField(
        required=True,
        widget=forms.EmailInput(attrs={'class': 'form-control-meet', 'placeholder': 'correo@ejemplo.com'})
    )
    password = forms.CharField(
        widget=forms.PasswordInput(attrs={'class': 'form-control-meet', 'placeholder': 'Contraseña segura'}),
        min_length=6
    )
    password_confirm = forms.CharField(
        widget=forms.PasswordInput(attrs={'class': 'form-control-meet', 'placeholder': 'Confirma tu contraseña'}),
        min_length=6
    )

    class Meta:
        model = User
        fields = ['username', 'first_name', 'last_name', 'email']
        widgets = {
            'username': forms.TextInput(attrs={'class': 'form-control-meet', 'placeholder': 'Nombre de usuario'}),
        }

    def clean(self):
        cleaned_data = super().clean()
        p1 = cleaned_data.get('password')
        p2 = cleaned_data.get('password_confirm')
        if p1 and p2 and p1 != p2:
            self.add_error('password_confirm', 'Las contraseñas no coinciden.')
        return cleaned_data

class ScheduleMeetingForm(forms.ModelForm):
    class Meta:
        model = Meeting
        fields = ['title', 'scheduled_date', 'start_time', 'end_time', 'description', 'requires_vpn']
        widgets = {
            'title': forms.TextInput(attrs={'class': 'form-control-meet', 'placeholder': 'Título de la reunión'}),
            'scheduled_date': forms.DateInput(attrs={'class': 'form-control-meet', 'type': 'date'}),
            'start_time': forms.TimeInput(attrs={'class': 'form-control-meet', 'type': 'time'}),
            'end_time': forms.TimeInput(attrs={'class': 'form-control-meet', 'type': 'time'}),
            'description': forms.Textarea(attrs={'class': 'form-control-meet', 'rows': 3, 'placeholder': 'Descripción o temas a tratar (opcional)'}),
            'requires_vpn': forms.CheckboxInput(attrs={'class': 'form-check-input'}),
        }

    def clean(self):
        cleaned_data = super().clean()
        start = cleaned_data.get('start_time')
        end = cleaned_data.get('end_time')
        if start and end and end <= start:
            self.add_error('end_time', 'La hora de fin debe ser posterior a la hora de inicio.')
        return cleaned_data
