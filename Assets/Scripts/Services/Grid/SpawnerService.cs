using System;
using System.Collections.Generic;
using Core.Entities;
using Cysharp.Threading.Tasks;
using Grid;
using Services.EventBus;
using UnityEngine;

namespace Services.Grid
{
    public class SpawnerService : MonoBehaviour
    {
        [SerializeField] private Entity rainbowEntity;
        private GridService _gridService;

        private void OnDisable()
        {
            _unsubscribeEvents();
        }

        public void Init()
        {
            _gridService = ServiceLocator.Get<GridService>();
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
            
            
            var newEntity = Instantiate(spawnEntity);
            newEntity.Init();
            newEntity.SetCell(cell);
            
            _gridService.AddEntity(newEntity);
        }


        private async UniTask _disposeEntityOnCell(Entity entity)
        {
            await entity.Health.Die();
        }

        private void _playerChainingAttackCombo(List<Cell> excludeCells)
        {
            var gridService = ServiceLocator.Get<GridService>();
            var cell = gridService.GetRandomCell(excludeCells);

            SpawnEntityOnCell(rainbowEntity, cell);
        }

        private void _subscribeEvents()
        {
            EventBusService.Subscribe<List<Cell>>(Actions.PlayerChainingAttackCombo, _playerChainingAttackCombo);
        }
        
        private void _unsubscribeEvents()
        {
            EventBusService.Unsubscribe<List<Cell>>(Actions.PlayerChainingAttackCombo, _playerChainingAttackCombo);
        }
    }
}