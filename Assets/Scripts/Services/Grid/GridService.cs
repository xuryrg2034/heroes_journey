﻿using System;
using System.Collections.Generic;
using System.Linq;
using System.Linq.Expressions;
using UnityEngine;
using Core.Entities;
using Cysharp.Threading.Tasks;
using Grid;
using JetBrains.Annotations;
using Unity.VisualScripting;
using Random = UnityEngine.Random;

namespace Services.Grid
{ 
    /// <summary>
    /// Отвечает за создание и управление игровым полем (сеткой),
    /// а также за объекты, размещенные на этой сетке.
    /// </summary>
    public class GridService : MonoBehaviour
    {
        [Header("Gizmo Settings")]
        [SerializeField] private Color gridColor = Color.gray;
        [SerializeField] private float cellSize = 1f;

        [Header("Grid Settings")]
        [SerializeField] private int width = 9;
        [SerializeField] private int height = 9;
        [SerializeField]private List<Entity> availableEntitiesList = new();

        private List<Entity> _entities = new();

        private Cell[,] _cells;

        private void OnDrawGizmos()
        {
            Gizmos.color = gridColor;

            // Горизонтальные линии
            for (var y = 0; y <= height; y++)
            {
                Gizmos.DrawLine(
                    new Vector3(0, y * cellSize, 0),
                    new Vector3(width * cellSize, y * cellSize, 0)
                );
            }

            // Вертикальные линии
            for (var x = 0; x <= width; x++)
            {
                Gizmos.DrawLine(
                    new Vector3(x * cellSize, 0, 0),
                    new Vector3(x * cellSize, height * cellSize, 0)
                );
            }
        }
        
        public void Init()
        {
            _cells = new Cell[width, height];

            _populateCellsFromScene();
            _populateEntitiesFromScene();
        }

        public List<T> GetEntitiesOfType<T>() where T : Entity
        {
            return _entities.OfType<T>().ToList();
        }
        
        public List<Enemy> GetEnemies()
        {
            return _entities.OfType<Enemy>().ToList();
        }
        
        // TODO: Нужна более мудренная логика спавна. Что бы не получалось, что на арене только красные например
        // TODO: Подумать как избавиться от асинхронного костыля (вероятно поможет обжект пул)
        public void SpawnEntitiesOnGrid()
        {
            foreach (var cell in _cells)
            {
                // Выбираем случайного противника из entitiesList
                var randomEnemy = availableEntitiesList[Random.Range(0, availableEntitiesList.Count)];
                var isCellEmpty = GetEntityAt(cell.Position) == null;
                
                // Проверяем, что ячейка не заблокирована и не занята
                if (!cell.IsAvailableForEntity() || !isCellEmpty) continue;
                
                var newEntity = Instantiate(randomEnemy);
                newEntity.Init();
                newEntity.SetCell(cell);

                _entities.Add(newEntity);
            }
        }

        public bool IsInsideGrid(Vector2Int position)
        {
            return (position.x >= 0 && position.x < width && position.y >= 0 && position.y < height);
        }

        public Cell GetCell(int x, int y)
        {
            return IsInsideGrid(new Vector2Int(x, y)) ? _cells[x, y] : null;
        }
        
        public Entity GetEntityAt(Vector2Int position)
        {
            return _entities.Where(e => e.Health.IsDead == false).FirstOrDefault(e => e.Cell.Position == position);
        }
        
        public void SpawnEntity(Entity entity, Cell cell)
        {
            var newEntity = Instantiate(entity);
            newEntity.Init();
            newEntity.SetCell(cell);
            
            _entities.Add(newEntity);
        }
        
        public async UniTask ApplyGravity()
        {
            var tasks = new List<UniTask>();
            
            for (var x = 0; x < _cells.GetLength(0); x++) // Проходим по всем столбцам
            {
                for (var y = 0; y < _cells.GetLength(1); y++) // Проходим по строкам снизу вверх
                {
                    var cell = _cells[x, y];
                    var entity = GetEntityAt(cell.Position);
                    if (!entity || entity.GetComponent<Hero>() != null) continue; // Герой не падает
                    
                    var targetCell = _getLowestAvailableCell(cell);
                    if (targetCell == null) continue;

                    var move = entity.Move(targetCell);

                    // Добавляем анимацию в последовательность
                    tasks.Add(move);
                }
            }

            await UniTask.WhenAll(tasks);
        }

        public async UniTask UpdateGrid()
        {
            _removeAllDeadEntity();

            await ApplyGravity();
         
            SpawnEntitiesOnGrid();
        }

        private void _removeAllDeadEntity()
        {
            _entities.RemoveAll(e =>
            {
                if (!e.Health.IsDead) return false;
                
                e.Dispose();
                return true;
            });
        }
        
        private Cell _getLowestAvailableCell(Cell startCell)
        {
            for (var y = 0; y < startCell.Position.y; y++) // Проходим снизу вверх до текущей ячейки
            {
                var potentialCell = GetCell(startCell.Position.x, y);
                if (potentialCell == null) continue;

                var entityInPotentialCell = GetEntityAt(potentialCell.Position);

                if (potentialCell != null && potentialCell.IsAvailableForEntity() && entityInPotentialCell == null)
                {
                    return potentialCell; // Возвращаем самую нижнюю доступную ячейку
                }
            }

            return null; // Если доступных ячеек нет, возвращаем null
        }
        
        private void _populateCellsFromScene()
        {
            var foundCells = FindObjectsByType<Cell>(FindObjectsSortMode.None);

            foreach (var cell in foundCells)
            {
                _cells[cell.Position.x, cell.Position.y] = cell;
                cell.Init();
            }
        }
        
        private void _populateEntitiesFromScene()
        {
            _entities = FindObjectsByType<Entity>(FindObjectsSortMode.None).ToList();

            foreach (var entity in _entities)
            {
                entity.Init();
                entity.SetCell(entity.Cell);
            }
        }
    }
}