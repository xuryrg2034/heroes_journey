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
        private readonly List<Entity> _ensuringDestructionEntities;
        
        private const int MaxStrengthEnemies = 5;  // Максимум офицеров на поле
        
        public SpawnService(List<Entity> availableEntities)
        {
            _availableEntitiesList = availableEntities;
            _spawnedEntities = _populateEntitiesFromScene();
        }
        
        public Entity SpawnEntityOnCell(Entity spawnEntity, Cell cell = default)
        {

            if (cell != null)
            {
                var entityOnCell = cell.GetEntity();

                if (entityOnCell != null)
                {
                    _disposeEntityOnCell(entityOnCell);
                }
            }
            
            
            var newEntity = Object.Instantiate(spawnEntity);
            newEntity.Init();
            newEntity.SetCell(cell);
            
            _spawnedEntities.Add(newEntity);

            return newEntity;
        }
        
        public Entity SpawnEntity(Cell cell)
        {
            if (!cell.IsAvailableForEntity()) return null;

            var entityToSpawn = _getEntityWithBalance();
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
                
                // _ensuringDestructionEntities.Add(e);
                return true;
            });
        }

        public List<Entity> GetSpawnedEntities() => _spawnedEntities.Where(e => !e.Health.IsDead).ToList();

        private Entity _getEntityWithBalance()
        {
            var enemies = GetSpawnedEntities().OfType<Enemy>().ToList();
            var strengthEnemies = enemies.Count(e => e.MaxHealth >= 5);

            // TODO: Нужна какая то другая логика спавна. Сейчас это не весело.
            if (strengthEnemies >= MaxStrengthEnemies) return _getRandomEnemyOfType(0);

            return _getRandomEnemyOfType(0, 5);
        }
        
        private Entity _getRandomEnemyOfType(params int[] allowedHp)
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
        
        private void _disposeEntityOnCell(Entity entity)
        {
            entity.Health.Die().Forget();
        }
    }
}