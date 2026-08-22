{{/*
  helpers.tpl — shared template helpers for the OceanOps chart

  TODO: these are standard Helm patterns — read through them once, then
  reference them in your Deployment/Service templates with {{ include "..." . }}
*/}}

{{/* Expand the chart name */}}
{{- define "oceanops.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/* Full release name, capped at 63 chars */}}
{{- define "oceanops.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}

{{/* Common labels applied to every resource */}}
{{- define "oceanops.labels" -}}
helm.sh/chart: {{ .Chart.Name }}-{{ .Chart.Version }}
app.kubernetes.io/name: {{ include "oceanops.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/* Selector labels (used in matchLabels — must be stable across upgrades) */}}
{{- define "oceanops.selectorLabels" -}}
app.kubernetes.io/name: {{ include "oceanops.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/* Resolve the Docker image reference for a given service block */}}
{{- define "oceanops.image" -}}
{{- $registry := .global.imageRegistry -}}
{{- $repo := .service.image.repository -}}
{{- $tag := coalesce .service.image.tag .global.imageTag "latest" -}}
{{- if $registry }}
{{- printf "%s/%s:%s" $registry $repo $tag }}
{{- else }}
{{- printf "%s:%s" $repo $tag }}
{{- end }}
{{- end }}
