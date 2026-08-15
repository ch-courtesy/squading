import { mountApp } from './app/app-shell'
import './app/styles.css'

const root = document.querySelector<HTMLElement>('#app')

if (!root) {
  throw new Error('App root not found')
}

mountApp(root)
