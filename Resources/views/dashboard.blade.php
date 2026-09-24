{{-- /cobrowse: Cobrowse.io dashboard as a full page, agent signed in by JWT. --}}
@extends('layouts.app')

@section('title', 'Cobrowse')

@section('content')
    <div class="cobrowse-page">
        @if (!$has_token)
            <p class="text-warning cobrowse-page-warn">{{ __('Automatic sign-in is off (no private key): Cobrowse will ask you to log in.') }}</p>
        @endif
        <iframe src="{{ $url }}" allow="clipboard-read; clipboard-write; fullscreen" allowfullscreen></iframe>
    </div>
@endsection
