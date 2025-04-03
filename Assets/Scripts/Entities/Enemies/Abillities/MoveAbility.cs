using System;
using System.Collections.Generic;
using Cysharp.Threading.Tasks;
using Grid;
using Services;
using UnityEngine;

namespace Entities.Enemies
{
    [Serializable]
    public class MoveAbility : BaseAbility
    {
        [SerializeField] public LayerMask targetLayer;

        GridService _gridService;


        public override void Initialize(Enemy owner)
        {
            base.Initialize(owner);
            
            _gridService = ServiceLocator.Get<GridService>();
        }

        public override async UniTask Execute()
        {
            if (_tryToExecute())
            {
                await _execute();
                _reset();
            }
            else if (State != State.Preparing)
            {
                _prepare();   
            }
        }

        public override void Cancel()
        {
            if (State != State.Preparing) return;

            _reset();
        }

        void _prepare()
        {
            State = State.Preparing;
        }

        async UniTask _execute()
        {
            State = State.Execute;
            
            var tasks = new List<UniTask>();
            var randomCell = _gridService.GetRandomAdjacentCell(Owner.GridPosition);
            
            // Если вдруг так получилось, что нет доступных ячеек
            if (randomCell == Owner.GridPosition) return;

            var tileCenter = GridService.GridPositionToTileCenter(randomCell);
            var hit = Physics2D.OverlapPoint(new Vector2(tileCenter.x, tileCenter.y), targetLayer);

            if (hit != null)
            {
                var targetEntity = hit.GetComponent<BaseEntity>();
                var targetMoveTask = targetEntity.Move(Owner.GridPosition);
                tasks.Add(targetMoveTask);
            } 
            
            var ownerMoveTask = Owner.Move(randomCell);
            _drawDebugPoint(randomCell, Color.red);
            
            tasks.Add(ownerMoveTask);
            
            await UniTask.WhenAll(tasks);
        }

        void _reset()
        {
            _castCounter = 0;
            State = State.Pending;
        }
    }
}