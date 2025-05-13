package command

import (
	"fmt"

	"github.com/lagzap/lagzap/adapter"
	C "github.com/lagzap/lagzap/constant"
	"github.com/lagzap/lagzap/protocol/multizap"
	"github.com/lagzap/zap/common"
	"github.com/lagzap/zap/common/batch"
	E "github.com/lagzap/zap/common/exceptions"
)

func (c *Command) Nodes() map[string]*adapter.EchoResult {
	nodes := make(map[string]*adapter.EchoResult)

	for _, detour := range c.outbound.Outbounds() {
		switch detour.Type() {
		case C.TypeDirect, C.TypeBlock, C.TypeDNS:
			continue
		}
		if detour.Tag() != "" {
			continue
		}
		
		if c.testHistory != nil {
			result := c.testHistory.LoadEchoTestHistory(adapter.OutboundTag(detour))
			fmt.Println(detour.Tag(), result)
			if result != nil {
				nodes[detour.Tag()] = result
			}
		}
	}
	return nodes
}

func (c *Command) GetLatency(force bool) error {
	if c.checking.Swap(true) {
		return nil
	}
	defer c.checking.Store(false)

	groups := common.Map(common.Filter(c.outbound.Outbounds(), func(detour adapter.Outbound) bool {
		_, isGroup := detour.(*multizap.Multizap)
		return detour.Tag() != "" && isGroup
	}), func(it adapter.Outbound) *multizap.Multizap {
		group, _ := it.(*multizap.Multizap)
		return group
	})

	b, _ := batch.New(c.ctx, batch.WithConcurrencyNum[any](10))
	for _, group := range groups {
		b.Go(group.Tag(), func() (any, error) {
			group.CheckOutbounds()
			return nil, nil
		})
	}
	b.Wait()
	return nil
}

func (c *Command) PingOutbound(tag string) (map[string]*adapter.EchoResult, error) {
	outbound, ok := c.outbound.Outbound(tag)
	if !ok {
		return nil, E.New("outbound not found: ", tag)
	}
	zapOutbound, ok := outbound.(*multizap.Multizap)
	if !ok {
		return nil, E.New("outbound cannot be pinged: ", tag)
	}
	return zapOutbound.EchoTest(c.ctx)
}

func RealTag(detour adapter.Outbound) string {
	if group, isGroup := detour.(adapter.OutboundGroup); isGroup {
		return group.Now()
	}
	return detour.Tag()
}
