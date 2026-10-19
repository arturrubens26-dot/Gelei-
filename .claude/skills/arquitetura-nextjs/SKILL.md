---
name: arquitetura-nextjs
description: Padrões de renderização (App Router), isolamento de Client Components e Code Splitting.
---

# Padrão Arquitetural: Next.js (App Router)

Esta diretriz substitui abstrações genéricas e impõe a engenharia de alta performance para aplicações web no contexto atual.

1. Topologia de Diretórios (Modularidade Estrita):
- É proibido concentrar lógicas de interface no arquivo raiz `app/page.tsx`. Este arquivo atua apenas como agregador de dependências de servidor.
- Componentes devem ser extraídos para a pasta `components/`, agrupados por domínio de negócio ou seção funcional (ex: `components/hero`, `components/pricing`).

2. Fronteira de Renderização (RSC vs. SSR/CSR):
- A diretiva `"use client"` é restrita aos nós folha da árvore de componentes, aplicada exclusivamente onde manipulação de estado, hooks de ciclo de vida ou listeners do DOM são necessários.
- A contaminação de Server Components pai com diretivas de cliente é uma falha arquitetural severa.

3. Performance Mobile e Code Splitting:
- Componentes localizados abaixo da dobra principal da aplicação devem ser instanciados no servidor através da função `next/dynamic`. Isso retarda o carregamento do bundle JavaScript e impede o bloqueio da thread principal durante a hidratação inicial.
