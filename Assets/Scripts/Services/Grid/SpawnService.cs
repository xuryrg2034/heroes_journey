using System;
using System.Collections.Generic;
using System.Linq;
using Core.Entities;
using Cysharp.Threading.Tasks;
using Grid;
using Services.EventBus;
using UnityEngine;
using Object = UnityEngine.Object;
using Random = UnityEngine.Random;

namespace Services.Grid
{
    // TODO: Нужна более мудренная логика спавна. Что бы не получалось, что на арене только красные например
    public class SpawnService
    {
        private readonly List<Entity> _availableEntitiesList;
        private readonly List<Entity> _spawnedEntities;
        
        private const int MaxOfficers = 5;  // Максимум офицеров на поле
        private const int MinBasicEnemies = 10; // Минимум базовых врагов
        
        public SpawnService(List<Entity> availableEntities)
        {
            _availableEntitiesList = availableEntities;
            _spawnedEntities = _populateEntitiesFromScene();
            _subscribeEvents();
        }
        
        public void SpawnEntityOnCell(Entity spawnEntity, Cell cell = default)
        {

            if (cell != null)
            {
                var entityOnCell = cell.GetEntity();

                if (entityOnCell != null)
                {
                    _disposeEntityOnCell(entityOnCell).Forget();
                }
            }
            
            
            var newEntity = Object.Instantiate(spawnEntity);
            newEntity.Init();
            newEntity.SetCell(cell);
            
            _spawnedEntities.Add(newEntity);
        }
        
        public Entity SpawnEntity(Cell cell)
        {
            if (!cell.IsAvailableForEntity()) return null;

            var entityToSpawn = GetEntityWithBalance();
            var newEntity = Object.Instantiate(entityToSpawn);
            newEntity.Init();
            newEntity.SetCell(cell);

            _spawnedEntities.Add(newEntity);

            return newEntity;
        }

        public void ClearDeadEntities()
        {
            _spawnedEntities.RemoveAll(e =>
            {
                if (!e.Health.IsDead) return false;
                e.Dispose();
                return true;
            });
        }

        public List<Entity> GetSpawnedEntities() => _spawnedEntities;

        private Entity GetEntityWithBalance()
        {
            var enemies = _spawnedEntities.OfType<Enemy>().ToList();
            var basicEnemies = enemies.Count(e => e.MaxHealth == 0);
            var officers = enemies.Count(e => e.MaxHealth == 5);

            // TODO: Нужна какая то другая логика спавна. Сейчас дичь.
            if (officers >= MaxOfficers || basicEnemies < MinBasicEnemies) return GetRandomEnemyOfType(0);

            return GetRandomEnemyOfType(0, 5, 20);
        }
        
        private Entity GetRandomEnemyOfType(params int[] allowedHp)
        {
            var possibleEnemies = _availableEntitiesList.Where(e => allowedHp.Contains(e.MaxHealth)).ToList();
            return possibleEnemies[Random.Range(0, possibleEnemies.Count)];
        }

        private List<Entity> _populateEntitiesFromScene()
        {
            var entities = Object.FindObjectsByType<Entity>(FindObjectsSortMode.None).ToList();

            foreach (var entity in entities)
            {
                entity.Init();
                entity.SetCell(entity.Cell);
            }

            return entities;
        }
        
        private async UniTask _disposeEntityOnCell(Entity entity)
        {
            await entity.Health.Die();
        }

        private void _playerChainingAttackCombo(List<Cell> excludeCells)
        {
            var gridService = ServiceLocator.Get<GridService>();
            var cell = gridService.GetRandomCell(excludeCells);

            // SpawnEntityOnCell(rainbowEntity, cell);
        }

        private void _subscribeEvents()
        {
            EventBusService.Subscribe<List<Cell>>(Actions.PlayerChainingAttackCombo, _playerChainingAttackCombo);
        }
    }
}